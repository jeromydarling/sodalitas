/**
 * scoring.ts — the nightly snapshot job and the weekly signal job.
 *
 * These two jobs are the product. Everything else is a database with a nice
 * front end; this is the part that notices things.
 *
 * Both are idempotent. Snapshots are keyed on (club, date) and signals on a
 * dedupe key, so a re-run after a failure repairs the gap rather than doubling
 * the data — which means a failed night is a shrug rather than an incident.
 */

import { tenantDb, globalDb, type TenantDb } from "@db/scope";
import { newId } from "@domain/ids";
import { scoreClubHealth, scoreMemberEngagement } from "@domain/scoring";
import { generateClubSignals, type ClubSignalInput, type MilestoneFactsForSignal } from "@domain/signals";
import { moveStage } from "@db/services/membership";
import {
  gatherClubFacts, gatherMemberFacts, gatherGuestFacts,
  gatherOverdueDues, gatherAnniversaries, gatherVacantOffices,
} from "@db/services/facts";
import { peopleWithOpenTasks, createTaskFromSignal } from "@db/services/interactions";
import { shiftDays } from "@db/services/membership";
import { materializeAllSeries } from "@db/services/meetings";
import type { Env } from "../context";

/** The offices we expect a club to have filled. Absence is worth mentioning. */
const EXPECTED_OFFICES = [
  { key: "club_president", label: "Club President" },
  { key: "club_secretary", label: "Club Secretary" },
  { key: "club_treasurer", label: "Club Treasurer" },
  { key: "membership_chair", label: "Membership Chair" },
];

interface ClubRef {
  id: string;
  tenant_id: string;
  name: string;
}

async function activeClubs(env: Env): Promise<ClubRef[]> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.tenant_id, c.name
       FROM clubs c
       JOIN tenants t ON t.id = c.tenant_id
      WHERE c.status = 'active' AND t.status = 'active'`,
  ).all<ClubRef>();
  return results ?? [];
}

// ── Nightly ───────────────────────────────────────────────────────────────────

export interface SnapshotStats {
  clubs: number;
  club_snapshots: number;
  member_snapshots: number;
  stage_moves: number;
  meetings_scheduled: number;
  errors: number;
}

/**
 * Recompute club health and member engagement for every active club.
 *
 * Also moves memberships between `active` and `at_risk` as the score crosses,
 * which is the one place scoring writes back to the record. That move is
 * itself a stage event, so a member who drifts and returns has both moments in
 * their history rather than a silently rewritten status.
 */
export async function runNightlySnapshots(env: Env, today: string, now: string): Promise<SnapshotStats> {
  const clubs = await activeClubs(env);
  const stats: SnapshotStats = {
    clubs: clubs.length,
    club_snapshots: 0,
    member_snapshots: 0,
    stage_moves: 0,
    meetings_scheduled: 0,
    errors: 0,
  };

  // Group by tenant so each gets one TenantDb rather than one per club.
  const byTenant = new Map<string, ClubRef[]>();
  for (const c of clubs) {
    const list = byTenant.get(c.tenant_id) ?? [];
    list.push(c);
    byTenant.set(c.tenant_id, list);
  }

  for (const [tenantId, tenantClubs] of byTenant) {
    const db = tenantDb(env.DB, tenantId);

    try {
      stats.meetings_scheduled += await materializeAllSeries(db, today, now);
    } catch (err) {
      console.error(`[snapshots] series for tenant ${tenantId}`, err);
      stats.errors++;
    }

    for (const club of tenantClubs) {
      try {
        const [clubFacts, memberFacts] = await Promise.all([
          gatherClubFacts(db, club.id, today),
          gatherMemberFacts(db, club.id, today),
        ]);

        const health = scoreClubHealth(clubFacts);
        await upsertClubSnapshot(db, club.id, today, now, health, clubFacts);
        stats.club_snapshots++;

        const scored = memberFacts.map((f) => ({ facts: f, score: scoreMemberEngagement(f) }));
        if (scored.length > 0) {
          await upsertMemberSnapshots(db, club.id, today, now, scored);
          stats.member_snapshots += scored.length;
        }

        stats.stage_moves += await reconcileRiskStages(db, club.id, scored, now);
      } catch (err) {
        console.error(`[snapshots] club ${club.id}`, err);
        stats.errors++;
      }
    }
  }

  return stats;
}

async function upsertClubSnapshot(
  db: TenantDb,
  clubId: string,
  today: string,
  now: string,
  health: ReturnType<typeof scoreClubHealth>,
  facts: Awaited<ReturnType<typeof gatherClubFacts>>,
): Promise<void> {
  await db.unsafeDb
    .prepare(
      `INSERT INTO club_health_snapshots
         (id, tenant_id, club_id, as_of, score, status, drivers, member_count,
          net_change_90d, attendance_rate, active_prospects, dues_delinquent_pct,
          version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?)
       ON CONFLICT (club_id, as_of) DO UPDATE SET
         score = excluded.score, status = excluded.status, drivers = excluded.drivers,
         member_count = excluded.member_count, net_change_90d = excluded.net_change_90d,
         attendance_rate = excluded.attendance_rate, active_prospects = excluded.active_prospects,
         dues_delinquent_pct = excluded.dues_delinquent_pct`,
    )
    .bind(
      newId("healthSnapshot"), db.tenantId, clubId, today,
      health.score, health.status,
      JSON.stringify({ drivers: health.drivers, reasons: health.reasons, actions: health.actions }),
      facts.memberCount, facts.netChange90d, facts.attendanceRate90d,
      facts.activeProspects, facts.duesDelinquentRate, now,
    )
    .run();
}

async function upsertMemberSnapshots(
  db: TenantDb,
  clubId: string,
  today: string,
  now: string,
  scored: { facts: Awaited<ReturnType<typeof gatherMemberFacts>>[number]; score: ReturnType<typeof scoreMemberEngagement> }[],
): Promise<void> {
  const raw = db.unsafeDb;
  const stmt = raw.prepare(
    `INSERT INTO member_engagement
       (id, tenant_id, club_id, person_id, membership_id, as_of, score, risk_level,
        drivers, reasons, last_attended_on, last_touch_on, attendance_rate_90d,
        committee_count, project_count, dues_current, version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?)
     ON CONFLICT (person_id, club_id, as_of) DO UPDATE SET
       score = excluded.score, risk_level = excluded.risk_level, drivers = excluded.drivers,
       reasons = excluded.reasons, last_touch_on = excluded.last_touch_on,
       attendance_rate_90d = excluded.attendance_rate_90d,
       committee_count = excluded.committee_count, project_count = excluded.project_count,
       dues_current = excluded.dues_current`,
  );

  // Chunked so a 400-member club doesn't build one enormous batch.
  const CHUNK = 50;
  for (let i = 0; i < scored.length; i += CHUNK) {
    await db.batch(
      scored.slice(i, i + CHUNK).map(({ facts, score }) =>
        stmt.bind(
          newId("engagement"), db.tenantId, clubId, facts.personId, facts.membershipId, today,
          score.score, score.status,
          JSON.stringify({ drivers: score.drivers, reasons: score.reasons, actions: score.actions }),
          score.reasons.join("\n"),
          facts.daysSinceAttended === null ? null : shiftDays(today, -facts.daysSinceAttended),
          facts.daysSinceTouch === null ? null : shiftDays(today, -facts.daysSinceTouch),
          facts.attendanceRate90d, facts.committeeCount, facts.projectCount,
          facts.duesCurrent ? 1 : 0, now,
        ),
      ),
    );
  }
}

/**
 * Move memberships in and out of `at_risk` as scores cross.
 *
 * Only two transitions are automatic — active→at_risk and at_risk→active — and
 * only from a steady score, not merely "no longer at risk". The gap stops a
 * member hovering on the boundary from being flagged and unflagged week after
 * week, which would fill their history with noise and the club's list with
 * cries of wolf.
 */
async function reconcileRiskStages(
  db: TenantDb,
  clubId: string,
  scored: { facts: { personId: string; membershipId: string; onLeave: boolean }; score: { status: string } }[],
  now: string,
): Promise<number> {
  const current = await db.all<{ id: string; stage: string }>("memberships", {
    columns: "id, stage",
    where: "club_id = ? AND stage IN ('active','at_risk')",
    params: [clubId],
    limit: 2000,
  });
  const stageById = new Map(current.map((c) => [c.id, c.stage]));
  let moves = 0;

  for (const { facts, score } of scored) {
    if (facts.onLeave) continue;
    const stage = stageById.get(facts.membershipId);
    if (!stage) continue;

    if (stage === "active" && score.status === "at_risk") {
      await moveStage(db, {
        membershipId: facts.membershipId,
        toStage: "at_risk",
        reason: "Engagement score fell below the threshold",
        actorUserId: null,
      }, now);
      moves++;
    } else if (stage === "at_risk" && score.status === "steady") {
      await moveStage(db, {
        membershipId: facts.membershipId,
        toStage: "active",
        reason: "Engagement recovered",
        actorUserId: null,
      }, now);
      moves++;
    }
  }
  return moves;
}

// ── Weekly ────────────────────────────────────────────────────────────────────

export interface SignalStats {
  clubs: number;
  signals_generated: number;
  signals_inserted: number;
  signals_deduped: number;
  tasks_created: number;
  errors: number;
}

/**
 * Generate the week's signals from the latest snapshots.
 *
 * Reads yesterday's snapshot rather than recomputing: the nightly job runs
 * ninety minutes earlier, and doing the work twice would double the cost to
 * produce the same answer.
 */
export async function runWeeklySignals(env: Env, today: string, now: string): Promise<SignalStats> {
  const clubs = await activeClubs(env);
  const weekStart = mondayOf(today);
  const stats: SignalStats = {
    clubs: clubs.length,
    signals_generated: 0,
    signals_inserted: 0,
    signals_deduped: 0,
    tasks_created: 0,
    errors: 0,
  };

  const byTenant = new Map<string, ClubRef[]>();
  for (const c of clubs) {
    const list = byTenant.get(c.tenant_id) ?? [];
    list.push(c);
    byTenant.set(c.tenant_id, list);
  }

  for (const [tenantId, tenantClubs] of byTenant) {
    const db = tenantDb(env.DB, tenantId);

    for (const club of tenantClubs) {
      try {
        const input = await buildSignalInput(db, club, today, weekStart);
        const signals = generateClubSignals(input);
        stats.signals_generated += signals.length;

        for (const s of signals) {
          const inserted = await insertSignal(db, s, now);
          if (inserted) {
            stats.signals_inserted++;
            // Signals that name a person become a task, so the work lands in
            // somebody's inbox rather than only on a dashboard.
            if (s.personId && (s.kind === "guest_follow_up" || s.kind === "at_risk")) {
              const taskId = await createTaskFromSignal(
                db,
                {
                  clubId: s.clubId,
                  title: s.title,
                  details: `${s.summary}\n\n${s.suggestedAction}`,
                  subjectPersonId: s.personId,
                  originRef: s.dedupeKey,
                  dueOn: shiftDays(today, 7),
                },
                now,
              );
              if (taskId) stats.tasks_created++;
            }
          } else {
            stats.signals_deduped++;
          }
        }
      } catch (err) {
        console.error(`[signals] club ${club.id}`, err);
        stats.errors++;
      }
    }
  }

  return stats;
}

async function buildSignalInput(
  db: TenantDb,
  club: ClubRef,
  today: string,
  weekStart: string,
): Promise<ClubSignalInput> {
  const [snapshot, priorSnapshot, engagement, guests, dues, anniversaries, vacant, openTasks] =
    await Promise.all([
      db.first<{ score: number; status: string; drivers: string; member_count: number }>(
        "club_health_snapshots",
        { where: "club_id = ?", params: [club.id], orderBy: "as_of DESC" },
      ),
      db.first<{ score: number; status: string }>("club_health_snapshots", {
        where: "club_id = ? AND as_of <= ?",
        params: [club.id, shiftDays(weekStart, -1)],
        orderBy: "as_of DESC",
      }),
      db.raw<{
        person_id: string; risk_level: string; score: number;
        last_attended_on: string | null; last_touch_on: string | null; reasons: string;
        first_name: string; last_name: string;
        preferred_name: string | null; stage: string; joined_on: string | null;
      }>(
        `SELECT e.person_id, e.risk_level, e.score, e.last_attended_on,
                e.last_touch_on, e.reasons,
                p.first_name, p.last_name, p.preferred_name, m.stage, m.joined_on
           FROM member_engagement e
           JOIN people p ON p.id = e.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
           JOIN memberships m ON m.id = e.membership_id AND m.tenant_id = {{tenant}}
          WHERE e.tenant_id = {{tenant}} AND e.club_id = ?
            AND e.as_of = (SELECT MAX(as_of) FROM member_engagement
                            WHERE tenant_id = {{tenant}} AND club_id = ?)`,
        [club.id, club.id],
      ),
      gatherGuestFacts(db, club.id, today),
      gatherOverdueDues(db, club.id, today),
      gatherAnniversaries(db, club.id, weekStart),
      gatherVacantOffices(db, club.id, today, EXPECTED_OFFICES),
      peopleWithOpenTasks(db, club.id),
    ]);

  const drivers = safeParse(snapshot?.drivers);

  return {
    clubId: club.id,
    clubName: club.name,
    weekStart,
    memberCount: snapshot?.member_count ?? 0,
    health: {
      score: snapshot?.score ?? 0,
      status: (snapshot?.status as ClubSignalInput["health"]["status"]) ?? "watch",
      reasons: Array.isArray(drivers.reasons) ? (drivers.reasons as string[]) : [],
    },
    healthLastWeek: priorSnapshot
      ? {
          score: priorSnapshot.score,
          status: priorSnapshot.status as ClubSignalInput["health"]["status"],
        }
      : null,
    members: engagement.map((e) => ({
      personId: e.person_id,
      name: `${e.preferred_name || e.first_name} ${e.last_name}`,
      risk: e.risk_level as "steady" | "watch" | "at_risk",
      score: e.score,
      daysSinceAttended: e.last_attended_on ? daysBetween(e.last_attended_on, today) : null,
      daysSinceTouch: e.last_touch_on ? daysBetween(e.last_touch_on, today) : null,
      reasons: e.reasons ? e.reasons.split("\n").filter(Boolean) : [],
      hasOpenTask: openTasks.has(e.person_id),
      anniversaryYears: anniversaries.get(e.person_id) ?? null,
      onLeave: e.stage === "leave_of_absence",
    })),
    guests: guests.map((g) => ({ ...g, hasOpenTask: openTasks.has(g.personId) })),
    overdueDues: dues.map((d) => ({ ...d, hasOpenTask: openTasks.has(d.personId) })),
    milestones: await gatherMilestones(db, club.id, today),
    vacantOffices: vacant,
  };
}

/**
 * Things worth saying out loud.
 *
 * Not decoration: a weekly list that is only ever bad news gets avoided, and an
 * avoided list helps nobody. Kept conservative so it stays credible — a club
 * congratulated for nothing stops believing the congratulations.
 */
async function gatherMilestones(
  db: TenantDb,
  clubId: string,
  today: string,
): Promise<MilestoneFactsForSignal[]> {
  const out: MilestoneFactsForSignal[] = [];
  const d90 = shiftDays(today, -90);

  const joined = await db.raw<{ n: number }>(
    `SELECT COUNT(*) AS n FROM memberships
      WHERE tenant_id = {{tenant}} AND club_id = ? AND joined_on >= ?`,
    [clubId, d90],
  );
  if ((joined[0]?.n ?? 0) >= 2) {
    out.push({
      kind: "members_gained",
      detail: `${joined[0]!.n} people joined in the last three months.`,
      value: joined[0]!.n,
    });
  }

  const completed = await db.all<{ name: string }>("projects", {
    columns: "name",
    where: "club_id = ? AND status = 'complete' AND ends_on >= ?",
    params: [clubId, shiftDays(today, -14)],
    limit: 3,
  });
  for (const p of completed) {
    out.push({ kind: "project_completed", detail: `${p.name} wrapped up.`, value: 1 });
  }

  const charter = await db.first<{ charter_date: string | null }>("clubs", {
    columns: "charter_date",
    where: "id = ?",
    params: [clubId],
  });
  if (charter?.charter_date) {
    const md = charter.charter_date.slice(5);
    const weekEnd = shiftDays(today, 6);
    if (md >= today.slice(5) && md <= weekEnd.slice(5)) {
      const years = Number(today.slice(0, 4)) - Number(charter.charter_date.slice(0, 4));
      if (years >= 1) {
        out.push({
          kind: "charter_anniversary",
          detail: `The club was chartered ${years} years ago this week.`,
          value: years,
        });
      }
    }
  }

  return out;
}

/** Insert a signal, or report that it already exists. */
async function insertSignal(
  db: TenantDb,
  s: ReturnType<typeof generateClubSignals>[number],
  now: string,
): Promise<boolean> {
  const res = await db.unsafeDb
    .prepare(
      `INSERT INTO signals
         (id, tenant_id, club_id, person_id, kind, severity, title, summary,
          evidence, suggested_action, dedupe_key, status, generator, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'rules', 'v1', ?)
       ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    )
    .bind(
      newId("signal"), db.tenantId, s.clubId, s.personId, s.kind, s.severity,
      s.title, s.summary, JSON.stringify(s.evidence), s.suggestedAction, s.dedupeKey, now,
    )
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function mondayOf(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function safeParse(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
