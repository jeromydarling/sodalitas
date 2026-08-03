/**
 * communio.ts — the data side of cross-club sharing.
 *
 * The judgement lives in domain/communio.ts, which is pure and heavily tested.
 * This is the part that reads and writes, and its job is to make sure nothing
 * reaches the database without going through that sanitiser first.
 *
 * The one rule worth restating: a club's roster is the most sensitive thing it
 * holds, and members did not join a service club to have their attendance
 * discussed by the club across town. Everything here shares counts and
 * sentences, never people.
 */

import type { TenantDb } from "../scope";
import { globalDb } from "../scope";
import { newId } from "@domain/ids";
import {
  sanitizeSignal, weekStartOf, scanGroup, buildActivityPulse,
  MIN_COHORT, type SanitizeResult, type GroupActivity, type RawSignal,
} from "@domain/communio";

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  visibility: string;
  created_by_tenant: string;
  created_at: string;
}

export interface GroupWithMembership extends GroupRow {
  cohort_size: number;
  sharing_level: string | null;
  joined: number;
}

/**
 * Groups this tenant is in, plus open groups it could join.
 *
 * Groups are cross-tenant by design — that is the feature — so the list itself
 * comes from GlobalDb. What a tenant can *see inside* a group still depends on
 * its own membership row.
 */
export async function listGroups(db: TenantDb, env: { DB: D1Database }): Promise<GroupWithMembership[]> {
  const g = globalDb(env.DB);
  const rows = await g.all<GroupWithMembership>(
    "communio_groups",
    `1 = 1 ORDER BY created_at`,
  );

  const mine = await db.all<{ group_id: string; sharing_level: string }>("communio_memberships", {
    columns: "group_id, sharing_level",
    limit: 100,
  });
  const byGroup = new Map(mine.map((m) => [m.group_id, m.sharing_level]));

  // Cohort size drives whether sharing is possible at all, so it is fetched
  // for every group rather than only the ones we're in.
  const counts = await env.DB.prepare(
    `SELECT group_id, COUNT(DISTINCT tenant_id) AS n FROM communio_memberships GROUP BY group_id`,
  ).all<{ group_id: string; n: number }>();
  const cohort = new Map((counts.results ?? []).map((c) => [c.group_id, c.n]));

  return rows
    .map((r) => ({
      ...r,
      cohort_size: cohort.get(r.id) ?? 0,
      sharing_level: byGroup.get(r.id) ?? null,
      joined: byGroup.has(r.id) ? 1 : 0,
    }))
    // Groups we're in first, then open ones we could join. Invite-only groups
    // we aren't in are not shown at all — their existence is not public.
    .filter((r) => r.joined === 1 || r.visibility === "open")
    .sort((a, b) => b.joined - a.joined || a.name.localeCompare(b.name));
}

export async function createGroup(
  db: TenantDb,
  input: { name: string; description?: string | null; scope?: string; visibility?: string; clubId: string | null },
  now: string,
): Promise<string> {
  const id = newId("group");
  // The group itself is cross-tenant, so it is written through the raw binding.
  await db.unsafeDb
    .prepare(
      `INSERT INTO communio_groups (id, name, description, scope, visibility, created_by_tenant, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name.trim(),
      input.description?.trim() ?? null,
      input.scope ?? "district",
      input.visibility ?? "invite",
      db.tenantId,
      now,
    )
    .run();

  await joinGroup(db, id, input.clubId, "summary", now);
  return id;
}

export function joinGroup(
  db: TenantDb,
  groupId: string,
  clubId: string | null,
  sharingLevel: string,
  now: string,
): Promise<void> {
  return db.insert("communio_memberships", {
    id: newId("groupMember"),
    group_id: groupId,
    club_id: clubId,
    sharing_level: sharingLevel,
    created_at: now,
  });
}

export async function leaveGroup(db: TenantDb, groupId: string, now: string): Promise<void> {
  const row = await db.first<{ id: string }>("communio_memberships", {
    columns: "id",
    where: "group_id = ?",
    params: [groupId],
  });
  if (row) await db.remove("communio_memberships", row.id, now);
}

export async function cohortSize(env: { DB: D1Database }, groupId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT tenant_id) AS n FROM communio_memberships WHERE group_id = ?`,
  )
    .bind(groupId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ── Sharing ───────────────────────────────────────────────────────────────────

/**
 * Share a signal into a group.
 *
 * Everything goes through the sanitiser, and the rejection reason comes back to
 * the caller so the club can be told plainly what happened. "We didn't share
 * that one because it named someone" builds trust; silence does not.
 */
export async function shareSignal(
  db: TenantDb,
  env: { DB: D1Database },
  input: { groupId: string; clubId: string | null; raw: RawSignal },
  now: string,
): Promise<SanitizeResult> {
  const cohort = await cohortSize(env, input.groupId);
  const result = sanitizeSignal(input.raw, {
    weekStart: weekStartOf(now),
    cohortSize: cohort,
  });

  if (!result.ok) return result;

  await db.insert("communio_shared_signals", {
    id: newId("sharedSignal"),
    group_id: input.groupId,
    club_id: input.clubId,
    signal_type: result.signal.signalType,
    signal_summary: result.signal.summary,
    week_start: result.signal.weekStart,
    created_at: now,
  });

  return result;
}

export interface SharedSignalRow {
  id: string;
  signal_type: string;
  signal_summary: string;
  week_start: string;
  /** True when this tenant posted it. Nothing else identifies the source. */
  mine: number;
}

/**
 * Read a group's shared signals.
 *
 * Only "was this mine?" is returned — never which other club posted what. A
 * feed that labelled every line with its club would make the anonymity
 * pointless and the sanitiser theatre.
 */
export function listSharedSignals(
  db: TenantDb,
  env: { DB: D1Database },
  groupId: string,
  limit = 40,
): Promise<SharedSignalRow[]> {
  return env.DB.prepare(
    `SELECT id, signal_type, signal_summary, week_start,
            CASE WHEN tenant_id = ? THEN 1 ELSE 0 END AS mine
       FROM communio_shared_signals
      WHERE group_id = ?
      ORDER BY week_start DESC, created_at DESC
      LIMIT ?`,
  )
    .bind(db.tenantId, groupId, limit)
    .all<SharedSignalRow>()
    .then((r) => r.results ?? []);
}

// ── Speakers ──────────────────────────────────────────────────────────────────

export interface SpeakerRow {
  id: string;
  name: string;
  topic: string;
  bio: string | null;
  contact_email: string | null;
  travel_radius: string | null;
  fee_note: string | null;
  created_at: string;
  mine: number;
}

/**
 * The shared speaker directory.
 *
 * The single most-requested thing district leaders ask each other for, and
 * nobody has a list. This one deliberately *does* carry a contact address —
 * the whole point is to be able to book them — but only because the club
 * adding a speaker is vouching for them and typing it knowingly.
 */
export function listSpeakers(
  db: TenantDb,
  env: { DB: D1Database },
  groupId: string,
): Promise<SpeakerRow[]> {
  return env.DB.prepare(
    `SELECT s.id, s.name, s.topic, s.bio, s.contact_email, s.travel_radius, s.fee_note, s.created_at,
            CASE WHEN s.tenant_id = ? THEN 1 ELSE 0 END AS mine
       FROM communio_speakers s
      WHERE s.group_id = ?
      ORDER BY s.created_at DESC
      LIMIT 100`,
  )
    .bind(db.tenantId, groupId)
    .all<SpeakerRow>()
    .then((r) => r.results ?? []);
}

export function addSpeaker(
  db: TenantDb,
  input: {
    groupId: string;
    clubId: string | null;
    name: string;
    topic: string;
    bio?: string | null;
    contactEmail?: string | null;
    travelRadius?: string | null;
    feeNote?: string | null;
  },
  now: string,
): Promise<void> {
  return db.insert("communio_speakers", {
    id: newId("speaker"),
    group_id: input.groupId,
    name: input.name.trim(),
    topic: input.topic.trim(),
    bio: input.bio?.trim() || null,
    contact_email: input.contactEmail?.trim() || null,
    travel_radius: input.travelRadius?.trim() || null,
    fee_note: input.feeNote?.trim() || null,
    vouched_by_club: input.clubId,
    created_at: now,
  });
}

// ── Asks ──────────────────────────────────────────────────────────────────────

export const REQUEST_CATEGORIES = [
  { key: "speaker", label: "Looking for a speaker" },
  { key: "volunteers", label: "Need volunteers" },
  { key: "advice", label: "Asking for advice" },
  { key: "co_host", label: "Looking to co-host" },
  { key: "supplies", label: "Need supplies or kit" },
] as const;

export interface RequestRow {
  id: string;
  category: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  mine: number;
  reply_count: number;
}

export function listRequests(
  db: TenantDb,
  env: { DB: D1Database },
  groupId: string,
): Promise<RequestRow[]> {
  return env.DB.prepare(
    `SELECT r.id, r.category, r.title, r.body, r.status, r.created_at,
            CASE WHEN r.tenant_id = ? THEN 1 ELSE 0 END AS mine,
            (SELECT COUNT(*) FROM communio_replies rp WHERE rp.request_id = r.id) AS reply_count
       FROM communio_requests r
      WHERE r.group_id = ? AND r.status = 'open'
      ORDER BY r.created_at DESC
      LIMIT 50`,
  )
    .bind(db.tenantId, groupId)
    .all<RequestRow>()
    .then((r) => r.results ?? []);
}

export function postRequest(
  db: TenantDb,
  input: { groupId: string; clubId: string | null; category: string; title: string; body: string },
  now: string,
): Promise<void> {
  return db.insert("communio_requests", {
    id: newId("request"),
    group_id: input.groupId,
    club_id: input.clubId,
    category: input.category,
    title: input.title.trim().slice(0, 200),
    body: input.body.trim().slice(0, 4000),
    status: "open",
    created_at: now,
  });
}

export function postReply(
  db: TenantDb,
  input: { requestId: string; body: string },
  now: string,
): Promise<void> {
  return db.insert("communio_replies", {
    id: newId("reply"),
    request_id: input.requestId,
    body: input.body.trim().slice(0, 4000),
    created_at: now,
  });
}

export function listReplies(
  env: { DB: D1Database },
  requestId: string,
): Promise<{ id: string; body: string; created_at: string }[]> {
  return env.DB.prepare(
    `SELECT id, body, created_at FROM communio_replies WHERE request_id = ? ORDER BY created_at`,
  )
    .bind(requestId)
    .all<{ id: string; body: string; created_at: string }>()
    .then((r) => r.results ?? []);
}

// ── Governance ────────────────────────────────────────────────────────────────

/**
 * Run the weekly anomaly scan across every group.
 *
 * Deliberately conservative — a governance system that cries wolf gets switched
 * off, and then it protects nobody.
 */
export async function runGovernanceScan(
  env: { DB: D1Database },
  now: string,
): Promise<{ groups: number; flags: number }> {
  const weekAgo = new Date(Date.parse(now) - 7 * 86400_000).toISOString();

  const groups = await env.DB.prepare(`SELECT id FROM communio_groups`).all<{ id: string }>();
  let flagged = 0;

  for (const g of groups.results ?? []) {
    const [shares, cohort] = await Promise.all([
      env.DB.prepare(
        `SELECT tenant_id, COUNT(*) AS n FROM communio_shared_signals
          WHERE group_id = ? AND created_at >= ? GROUP BY tenant_id`,
      )
        .bind(g.id, weekAgo)
        .all<{ tenant_id: string; n: number }>(),
      cohortSize(env, g.id),
    ]);

    const activity: GroupActivity = {
      groupId: g.id,
      cohortSize: cohort,
      sharesByTenant: Object.fromEntries((shares.results ?? []).map((s) => [s.tenant_id, s.n])),
      // Rejections aren't persisted — the sanitiser refuses before anything is
      // written, which is the right place for it. Recording attempted shares
      // would mean storing the very text we declined to store.
      rejectionsByTenant: {},
    };

    for (const flag of scanGroup(activity)) {
      // Don't re-raise the same flag while an earlier one is still open.
      const existing = await env.DB.prepare(
        `SELECT id FROM communio_governance_flags
          WHERE group_id = ? AND flag_type = ? AND status = 'open' AND created_at >= ?`,
      )
        .bind(g.id, flag.flagType, weekAgo)
        .first<{ id: string }>();
      if (existing) continue;

      await env.DB.prepare(
        `INSERT INTO communio_governance_flags
           (id, group_id, tenant_id, flag_type, severity, details, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
        .bind(newId("govFlag"), g.id, flag.tenantId, flag.flagType, flag.severity, flag.details, now)
        .run();
      flagged++;
    }
  }

  return { groups: (groups.results ?? []).length, flags: flagged };
}

export { MIN_COHORT, buildActivityPulse };
