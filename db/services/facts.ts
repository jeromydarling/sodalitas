/**
 * facts.ts — gathering what the scoring engines need.
 *
 * The engines in domain/scoring.ts are pure: facts in, score out. This is where
 * those facts come from, and it is deliberately the only place that knows both
 * the database and the shape the engines want. Keeping the two apart is what
 * lets the judgements ("a member on leave is not drifting") be tested without a
 * database and the queries be optimised without touching the judgements.
 *
 * Everything here is club-at-a-time and batched. The nightly job scores every
 * club in a tenant, and a district with 60 clubs and 3,000 members cannot be
 * 3,000 round trips.
 */

import type { TenantDb } from "../scope";
import type { ClubFacts, MemberFacts } from "@domain/scoring";
import { shiftDays } from "./membership";

// ── Club facts ────────────────────────────────────────────────────────────────

/**
 * Everything scoreClubHealth needs, in five queries rather than fifteen.
 *
 * Note what is deliberately null rather than zero: a club that has never
 * recorded attendance gets `attendanceRate90d: null`, not `0`. The scorer
 * treats those as different situations and it matters — one is a club with an
 * empty room, the other is a club that signed up on Tuesday.
 */
export async function gatherClubFacts(
  db: TenantDb,
  clubId: string,
  today: string,
): Promise<ClubFacts> {
  const d90 = shiftDays(today, -90);
  const d180 = shiftDays(today, -180);
  const d365 = shiftDays(today, -365);
  const d30 = shiftDays(today, -30);

  const [counts, projects, attendance, priorAttendance, participation, dues, lastActivity] =
    await Promise.all([
      // Conditional aggregation rather than six UNIONed counts: one scan of the
      // club's memberships instead of six, and it stays inside D1's five-term
      // compound-SELECT ceiling.
      db.raw<{
        members: number; joined_90d: number; left_90d: number;
        left_365d: number; prospects: number; at_risk: number;
      }>(
        `SELECT
           SUM(CASE WHEN stage IN ('active','at_risk','leave_of_absence') THEN 1 ELSE 0 END) AS members,
           SUM(CASE WHEN joined_on >= ? THEN 1 ELSE 0 END) AS joined_90d,
           SUM(CASE WHEN ended_on >= ? THEN 1 ELSE 0 END) AS left_90d,
           SUM(CASE WHEN ended_on >= ? THEN 1 ELSE 0 END) AS left_365d,
           SUM(CASE WHEN stage IN ('lead','guest_attended','in_conversation','invited_to_apply','candidate')
                    THEN 1 ELSE 0 END) AS prospects,
           SUM(CASE WHEN stage = 'at_risk' THEN 1 ELSE 0 END) AS at_risk
         FROM memberships
        WHERE tenant_id = {{tenant}} AND club_id = ?`,
        [d90, d90, d365, clubId],
      ),

      db.raw<{ n: number }>(
        `SELECT COUNT(*) AS n FROM projects
          WHERE tenant_id = {{tenant}} AND club_id = ?
            AND status IN ('active','complete')
            AND (ends_on IS NULL OR ends_on >= ?)`,
        [clubId, d180],
      ),

      attendanceRate(db, clubId, d90, today),
      attendanceRate(db, clubId, shiftDays(today, -180), d90),

      db.raw<{ k: string; n: number }>(
        `SELECT 'committees' AS k, COUNT(DISTINCT cm.person_id) AS n
           FROM committee_members cm
           JOIN committees c ON c.id = cm.committee_id AND c.tenant_id = {{tenant}}
          WHERE cm.tenant_id = {{tenant}} AND c.club_id = ? AND c.active = 1
            AND (cm.ends_on IS NULL OR cm.ends_on >= ?)
         UNION ALL
         SELECT 'projects', COUNT(DISTINCT pp.person_id)
           FROM project_participants pp
           JOIN projects pr ON pr.id = pp.project_id AND pr.tenant_id = {{tenant}}
          WHERE pp.tenant_id = {{tenant}} AND pr.club_id = ?
            AND (pr.ends_on IS NULL OR pr.ends_on >= ?)`,
        [clubId, today, clubId, d180],
      ),

      db.raw<{ total: number; overdue: number }>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('open','partial') AND due_on < ? THEN 1 ELSE 0 END) AS overdue
           FROM dues_invoices
          WHERE tenant_id = {{tenant}} AND club_id = ? AND status != 'void'`,
        [today, clubId],
      ),

      lastActivityAt(db, clubId),
    ]);

  const c = counts[0];
  const get = (k: keyof NonNullable<typeof c>) => Number(c?.[k] ?? 0);
  const memberCount = get("members");

  // At-risk members who've had a real conversation in the last 30 days. This
  // is the follow-through measure: did the club act on what it already knew?
  const touched = await db.raw<{ n: number }>(
    `SELECT COUNT(DISTINCT m.person_id) AS n
       FROM memberships m
       JOIN interactions i ON i.person_id = m.person_id
        AND i.tenant_id = {{tenant}}
        AND i.kind IN ('call','email_out','meeting','note')
        AND i.occurred_at >= ?
      WHERE m.tenant_id = {{tenant}} AND m.club_id = ? AND m.stage = 'at_risk'`,
    [`${d30}T00:00:00.000Z`, clubId],
  );

  const guests = await db.raw<{ n: number }>(
    `SELECT COUNT(DISTINCT COALESCE(person_id, guest_email, guest_name)) AS n
       FROM meeting_attendance
      WHERE tenant_id = {{tenant}} AND club_id = ? AND is_guest = 1 AND created_at >= ?`,
    [clubId, `${d90}T00:00:00.000Z`],
  );

  const duesRow = dues[0];

  return {
    memberCount,
    netChange90d: get("joined_90d") - get("left_90d"),
    departures90d: get("left_90d"),
    departures365d: get("left_365d"),
    attendanceRate90d: attendance,
    attendanceRatePrior90d: priorAttendance,
    activeProspects: get("prospects"),
    guests90d: guests[0]?.n ?? 0,
    membersOnCommittees: participation.find((p) => p.k === "committees")?.n ?? 0,
    membersOnProjects: participation.find((p) => p.k === "projects")?.n ?? 0,
    activeProjects: projects[0]?.n ?? 0,
    duesDelinquentRate:
      duesRow && duesRow.total > 0 ? (duesRow.overdue ?? 0) / duesRow.total : null,
    atRiskMembers: get("at_risk"),
    atRiskMembersTouched: touched[0]?.n ?? 0,
    daysSinceLastActivity: lastActivity ? daysSince(lastActivity, today) : null,
  };
}

/**
 * When did anything last happen in this club?
 *
 * Checked across the tables a club actually touches, because a club can be busy
 * with projects in a month when nobody logged a meeting. Run as parallel
 * queries and reduced here rather than as one UNION — five sources is exactly
 * D1's compound-SELECT ceiling, and adding a sixth later would break it in a
 * way that's hard to trace back to this line.
 */
async function lastActivityAt(db: TenantDb, clubId: string): Promise<string | null> {
  const SOURCES: { table: string; column: string }[] = [
    { table: "interactions", column: "created_at" },
    { table: "meeting_attendance", column: "created_at" },
    { table: "memberships", column: "updated_at" },
    { table: "meetings", column: "updated_at" },
    { table: "projects", column: "updated_at" },
  ];

  const results = await Promise.all(
    SOURCES.map((s) =>
      db.raw<{ at: string | null }>(
        `SELECT MAX(${s.column}) AS at FROM ${s.table}
          WHERE tenant_id = {{tenant}} AND club_id = ?`,
        [clubId],
      ),
    ),
  );

  // ISO-8601 sorts lexicographically, so a plain string comparison is correct.
  let latest: string | null = null;
  for (const r of results) {
    const at = r[0]?.at ?? null;
    if (at && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/**
 * Share of active members present at a typical meeting in a window.
 *
 * Returns null when no meetings were held or nothing was recorded — an absence
 * of data, not an attendance of zero. Getting this wrong tells every club that
 * hasn't started taking attendance yet that it's failing.
 */
async function attendanceRate(
  db: TenantDb,
  clubId: string,
  from: string,
  to: string,
): Promise<number | null> {
  const rows = await db.raw<{ meetings: number; present: number; marked: number }>(
    `SELECT COUNT(DISTINCT m.id) AS meetings,
            SUM(CASE WHEN a.status IN ('present','makeup') THEN 1 ELSE 0 END) AS present,
            COUNT(a.id) AS marked
       FROM meetings m
       LEFT JOIN meeting_attendance a
         ON a.meeting_id = m.id AND a.tenant_id = {{tenant}} AND a.is_guest = 0
      WHERE m.tenant_id = {{tenant}}
        AND m.club_id = ?
        AND m.cancelled = 0
        AND m.meeting_date >= ? AND m.meeting_date < ?`,
    [clubId, from, to],
  );

  const r = rows[0];
  if (!r || r.meetings === 0 || r.marked === 0) return null;
  return Math.min(1, (r.present ?? 0) / r.marked);
}

function daysSince(isoTimestamp: string, today: string): number {
  const diff = Date.parse(`${today}T23:59:59Z`) - Date.parse(isoTimestamp);
  return Math.max(0, Math.floor(diff / 86_400_000));
}

// ── Member facts ──────────────────────────────────────────────────────────────

export interface MemberFactsRow extends MemberFacts {
  personId: string;
  membershipId: string;
  name: string;
}

/**
 * Facts for every current member of a club, in four queries total.
 *
 * The naive shape here is one query per member, which for a 90-member club is
 * 90 sequential round trips inside a Worker's subrequest budget. These fetch
 * the whole club and join in memory instead.
 */
export async function gatherMemberFacts(
  db: TenantDb,
  clubId: string,
  today: string,
): Promise<MemberFactsRow[]> {
  const d90 = shiftDays(today, -90);

  const d180 = shiftDays(today, -180);

  const [members, attendance, touches, involvement, dues, events] = await Promise.all([
    db.raw<{
      membership_id: string; person_id: string; first_name: string; last_name: string;
      preferred_name: string | null; membership_type: string; stage: string;
      joined_on: string | null; created_at: string;
    }>(
      `SELECT m.id AS membership_id, m.person_id, p.first_name, p.last_name, p.preferred_name,
              m.membership_type, m.stage, m.joined_on, m.created_at
         FROM memberships m
         JOIN people p ON p.id = m.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
        WHERE m.tenant_id = {{tenant}} AND m.club_id = ?
          AND m.stage IN ('active','at_risk','leave_of_absence')`,
      [clubId],
    ),

    db.raw<{ person_id: string; last_present: string | null; present: number; marked: number }>(
      `SELECT a.person_id,
              MAX(CASE WHEN a.status IN ('present','makeup') THEN m.meeting_date END) AS last_present,
              SUM(CASE WHEN a.status IN ('present','makeup') AND m.meeting_date >= ? THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN m.meeting_date >= ? THEN 1 ELSE 0 END) AS marked
         FROM meeting_attendance a
         JOIN meetings m ON m.id = a.meeting_id AND m.tenant_id = {{tenant}} AND m.cancelled = 0
        WHERE a.tenant_id = {{tenant}} AND a.club_id = ? AND a.person_id IS NOT NULL
        GROUP BY a.person_id`,
      [d90, d90, clubId],
    ),

    db.raw<{ person_id: string; last_touch: string }>(
      `SELECT person_id, MAX(occurred_at) AS last_touch
         FROM interactions
        WHERE tenant_id = {{tenant}} AND club_id = ?
          AND kind IN ('call','email_out','meeting','note')
          AND person_id IS NOT NULL
        GROUP BY person_id`,
      [clubId],
    ),

    db.raw<{ person_id: string; committees: number; projects: number }>(
      `SELECT person_id, SUM(is_committee) AS committees, SUM(1 - is_committee) AS projects FROM (
         SELECT cm.person_id, 1 AS is_committee
           FROM committee_members cm
           JOIN committees c ON c.id = cm.committee_id AND c.tenant_id = {{tenant}}
          WHERE cm.tenant_id = {{tenant}} AND c.club_id = ? AND c.active = 1
            AND (cm.ends_on IS NULL OR cm.ends_on >= ?)
         UNION ALL
         SELECT pp.person_id, 0
           FROM project_participants pp
           JOIN projects pr ON pr.id = pp.project_id AND pr.tenant_id = {{tenant}}
          WHERE pp.tenant_id = {{tenant}} AND pr.club_id = ?
            AND (pr.ends_on IS NULL OR pr.ends_on >= ?)
       ) GROUP BY person_id`,
      [clubId, today, clubId, shiftDays(today, -180)],
    ),

    db.raw<{ person_id: string; overdue: number }>(
      `SELECT person_id, COUNT(*) AS overdue
         FROM dues_invoices
        WHERE tenant_id = {{tenant}} AND club_id = ?
          AND status IN ('open','partial') AND due_on < ?
        GROUP BY person_id`,
      [clubId, today],
    ),

    // Club events. This is the join that makes an events module worth building
    // here rather than pointing clubs at Eventbrite: the member who runs the
    // auction every year and never makes a Tuesday stops reading as drifting.
    // Cancelled events are excluded — nobody failed to attend those.
    db.raw<{ person_id: string; last_event: string | null; attended: number; no_shows: number }>(
      `SELECT r.person_id,
              MAX(CASE WHEN r.status = 'attended' THEN e.starts_on END) AS last_event,
              SUM(CASE WHEN r.status = 'attended' AND e.starts_on >= ? THEN 1 ELSE 0 END) AS attended,
              SUM(CASE WHEN r.status = 'no_show'  AND e.starts_on >= ? THEN 1 ELSE 0 END) AS no_shows
         FROM event_registrations r
         JOIN events e ON e.id = r.event_id AND e.tenant_id = {{tenant}} AND e.status != 'cancelled'
        WHERE r.tenant_id = {{tenant}} AND r.club_id = ? AND r.person_id IS NOT NULL
        GROUP BY r.person_id`,
      [d180, d180, clubId],
    ),
  ]);

  const att = new Map(attendance.map((a) => [a.person_id, a]));
  const touch = new Map(touches.map((t) => [t.person_id, t.last_touch]));
  const inv = new Map(involvement.map((i) => [i.person_id, i]));
  const overdue = new Set(dues.filter((d) => d.overdue > 0).map((d) => d.person_id));
  const ev = new Map(events.map((e) => [e.person_id, e]));

  return members.map((m) => {
    const a = att.get(m.person_id);
    const i = inv.get(m.person_id);
    const e = ev.get(m.person_id);
    const lastTouch = touch.get(m.person_id);

    // Fall back to the membership record's creation when no join date was
    // captured — an imported roster often has neither, and treating a
    // long-standing member as brand new would hand them a grace period they
    // don't need and skew their tenure to zero.
    const joinedRef = m.joined_on ?? m.created_at.slice(0, 10);

    return {
      personId: m.person_id,
      membershipId: m.membership_id,
      name: `${m.preferred_name || m.first_name} ${m.last_name}`,
      daysSinceAttended: a?.last_present ? daysBetweenDates(a.last_present, today) : null,
      attendanceRate90d: a && a.marked > 0 ? Math.min(1, a.present / a.marked) : null,
      daysSinceEvent: e?.last_event ? daysBetweenDates(e.last_event, today) : null,
      eventCount: e?.attended ?? 0,
      eventNoShows: e?.no_shows ?? 0,
      daysSinceTouch: lastTouch ? daysSince(lastTouch, today) : null,
      committeeCount: i?.committees ?? 0,
      projectCount: i?.projects ?? 0,
      duesCurrent: !overdue.has(m.person_id),
      daysSinceJoined: daysBetweenDates(joinedRef, today),
      membershipType: (m.membership_type as MemberFacts["membershipType"]) ?? "active",
      onLeave: m.stage === "leave_of_absence",
    };
  });
}

function daysBetweenDates(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// ── Signal inputs ─────────────────────────────────────────────────────────────

export interface GuestFactsRow {
  personId: string;
  name: string;
  daysSinceVisit: number;
  visitCount: number;
  stage: string;
  hostName: string | null;
}

/** Guests who've visited recently, with how long ago and who brought them. */
export async function gatherGuestFacts(
  db: TenantDb,
  clubId: string,
  today: string,
): Promise<GuestFactsRow[]> {
  const since = shiftDays(today, -120);
  const rows = await db.raw<{
    person_id: string; first_name: string; last_name: string; preferred_name: string | null;
    stage: string; last_visit: string; visits: number;
    host_first: string | null; host_last: string | null;
  }>(
    `SELECT p.id AS person_id, p.first_name, p.last_name, p.preferred_name,
            COALESCE(m.stage, 'lead') AS stage,
            MAX(mt.meeting_date) AS last_visit,
            COUNT(DISTINCT mt.id) AS visits,
            MAX(h.first_name) AS host_first, MAX(h.last_name) AS host_last
       FROM meeting_attendance a
       JOIN meetings mt ON mt.id = a.meeting_id AND mt.tenant_id = {{tenant}}
       JOIN people p ON p.id = a.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
       LEFT JOIN memberships m ON m.person_id = p.id AND m.club_id = ? AND m.tenant_id = {{tenant}}
       LEFT JOIN people h ON h.id = a.host_person_id AND h.tenant_id = {{tenant}}
      WHERE a.tenant_id = {{tenant}} AND a.club_id = ? AND a.is_guest = 1
        AND mt.meeting_date >= ?
      GROUP BY p.id`,
    [clubId, clubId, since],
  );

  return rows.map((r) => ({
    personId: r.person_id,
    name: `${r.preferred_name || r.first_name} ${r.last_name}`,
    daysSinceVisit: daysBetweenDates(r.last_visit, today),
    visitCount: r.visits,
    stage: r.stage,
    hostName: r.host_first ? `${r.host_first} ${r.host_last ?? ""}`.trim() : null,
  }));
}

export interface DuesFactsRow {
  personId: string;
  name: string;
  daysOverdue: number;
  amountCents: number;
}

export async function gatherOverdueDues(
  db: TenantDb,
  clubId: string,
  today: string,
): Promise<DuesFactsRow[]> {
  const rows = await db.raw<{
    person_id: string; first_name: string; last_name: string; preferred_name: string | null;
    due_on: string; outstanding: number;
  }>(
    `SELECT p.id AS person_id, p.first_name, p.last_name, p.preferred_name,
            MIN(d.due_on) AS due_on,
            SUM(d.amount_cents - d.paid_cents) AS outstanding
       FROM dues_invoices d
       JOIN people p ON p.id = d.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
      WHERE d.tenant_id = {{tenant}} AND d.club_id = ?
        AND d.status IN ('open','partial') AND d.due_on < ?
      GROUP BY p.id`,
    [clubId, today],
  );

  return rows.map((r) => ({
    personId: r.person_id,
    name: `${r.preferred_name || r.first_name} ${r.last_name}`,
    daysOverdue: daysBetweenDates(r.due_on, today),
    amountCents: r.outstanding,
  }));
}

/** Members whose club anniversary falls in the coming week. */
export async function gatherAnniversaries(
  db: TenantDb,
  clubId: string,
  weekStart: string,
): Promise<Map<string, number>> {
  const rows = await db.all<{ person_id: string; joined_on: string }>("memberships", {
    columns: "person_id, joined_on",
    where: "club_id = ? AND joined_on IS NOT NULL AND stage IN ('active','at_risk','leave_of_absence')",
    params: [clubId],
    limit: 1000,
  });

  const out = new Map<string, number>();
  const weekEnd = shiftDays(weekStart, 6);
  const startMd = weekStart.slice(5);
  const endMd = weekEnd.slice(5);
  const wraps = endMd < startMd; // the week straddles new year

  for (const r of rows) {
    const md = r.joined_on.slice(5);
    const inWeek = wraps ? md >= startMd || md <= endMd : md >= startMd && md <= endMd;
    if (!inWeek) continue;
    const years = Number(weekStart.slice(0, 4)) - Number(r.joined_on.slice(0, 4));
    if (years >= 1) out.set(r.person_id, years);
  }
  return out;
}

/** Club offices with nobody currently holding them. */
export async function gatherVacantOffices(
  db: TenantDb,
  clubId: string,
  today: string,
  expected: { key: string; label: string }[],
): Promise<string[]> {
  const held = await db.all<{ role_key: string }>("role_assignments", {
    columns: "role_key",
    where:
      "scope_type = 'club' AND scope_id = ? AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)",
    params: [clubId, today, today],
    limit: 200,
  });
  const heldKeys = new Set(held.map((h) => h.role_key));
  return expected.filter((e) => !heldKeys.has(e.key)).map((e) => e.label);
}
