/**
 * membership.ts — the pipeline from guest to member, and out again.
 *
 * A membership is a relationship between a person and a club, not a status
 * column on the person. Every stage move writes an append-only event, so the
 * guest-to-member conversion report stays honest after somebody edits a record
 * — and so a club can answer "when did we actually approve her?" a year later.
 *
 * Exit reasons are recorded on the way out, because they are the single most
 * valuable retention data a club will ever have and almost nobody keeps them.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";

export const STAGES = [
  "lead",
  "guest_attended",
  "in_conversation",
  "invited_to_apply",
  "candidate",
  "approved",
  "active",
  "at_risk",
  "leave_of_absence",
  "resigned",
  "alumni",
] as const;

export type Stage = (typeof STAGES)[number];

/** What a Rotarian calls each stage. Never show the key. */
export const STAGE_LABELS: Record<Stage, string> = {
  lead: "Referred",
  guest_attended: "Visited",
  in_conversation: "In conversation",
  invited_to_apply: "Invited to apply",
  candidate: "Candidate",
  approved: "Approved",
  active: "Active member",
  at_risk: "Drifting",
  leave_of_absence: "On leave",
  resigned: "Resigned",
  alumni: "Former member",
};

/** The stages that form the recruitment funnel, in order, for the board view. */
export const PIPELINE_STAGES: Stage[] = [
  "lead",
  "guest_attended",
  "in_conversation",
  "invited_to_apply",
  "candidate",
  "approved",
];

/** Stages meaning "this person is currently in the club". */
export const ACTIVE_STAGES: Stage[] = ["active", "at_risk", "leave_of_absence"];

/** Stages meaning "this person has left". */
export const DEPARTED_STAGES: Stage[] = ["resigned", "alumni"];

export function isActiveStage(stage: string): boolean {
  return (ACTIVE_STAGES as string[]).includes(stage);
}

export function isPipelineStage(stage: string): boolean {
  return (PIPELINE_STAGES as string[]).includes(stage);
}

/**
 * Why someone left. Offered as a list because free text gets skipped, and a
 * blank exit reason is a club's most expensive missing field.
 */
export const EXIT_REASONS = [
  { key: "moved_away", label: "Moved away" },
  { key: "time", label: "Couldn't make the time commitment" },
  { key: "cost", label: "Cost of dues" },
  { key: "meeting_time", label: "Meeting time stopped working" },
  { key: "not_engaged", label: "Didn't feel connected to the club" },
  { key: "health", label: "Health" },
  { key: "job_change", label: "Job change" },
  { key: "transferred", label: "Transferred to another club" },
  { key: "deceased", label: "Passed away" },
  { key: "other", label: "Something else" },
] as const;

export interface MembershipRow {
  id: string;
  club_id: string;
  person_id: string;
  stage: Stage;
  membership_type: "active" | "honorary" | "corporate" | "satellite";
  stage_entered_at: string;
  joined_on: string | null;
  ended_on: string | null;
  exit_reason: string | null;
  exit_notes: string | null;
  sponsor_person_id: string | null;
  mentor_person_id: string | null;
  referred_by_person_id: string | null;
  source: string | null;
  is_primary_club: number;
  created_at: string;
  updated_at: string;
}

// ── Reading ───────────────────────────────────────────────────────────────────

export function getMembership(db: TenantDb, id: string): Promise<MembershipRow | null> {
  return db.byId<MembershipRow>("memberships", id);
}

export function getMembershipFor(
  db: TenantDb,
  clubId: string,
  personId: string,
): Promise<MembershipRow | null> {
  return db.first<MembershipRow>("memberships", {
    where: "club_id = ? AND person_id = ?",
    params: [clubId, personId],
  });
}

export function listMembershipsForPerson(db: TenantDb, personId: string): Promise<MembershipRow[]> {
  return db.all<MembershipRow>("memberships", {
    where: "person_id = ?",
    params: [personId],
    orderBy: "is_primary_club DESC, created_at",
  });
}

export interface PipelineEntry extends MembershipRow {
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  days_in_stage: number;
}

/**
 * The recruitment board: everyone not yet a member, with how long they've been
 * sitting where they are.
 *
 * Days-in-stage is the number the membership chair actually reads. A candidate
 * who has been "in conversation" for 200 days isn't in conversation.
 */
export async function listPipeline(
  db: TenantDb,
  clubId: string,
  today: string,
): Promise<PipelineEntry[]> {
  const rows = await db.raw<MembershipRow & { first_name: string; last_name: string; preferred_name: string | null; email: string | null }>(
    `SELECT m.*, p.first_name, p.last_name, p.preferred_name, p.email
       FROM memberships m
       JOIN people p ON p.id = m.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
      WHERE m.tenant_id = {{tenant}}
        AND m.club_id = ?
        AND m.stage IN (${PIPELINE_STAGES.map(() => "?").join(",")})
      ORDER BY m.stage_entered_at`,
    [clubId, ...PIPELINE_STAGES],
  );

  return rows.map((r) => ({ ...r, days_in_stage: daysBetween(r.stage_entered_at.slice(0, 10), today) }));
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

// ── Writing ───────────────────────────────────────────────────────────────────

export interface CreateMembershipInput {
  clubId: string;
  personId: string;
  stage?: Stage;
  membershipType?: MembershipRow["membership_type"];
  joinedOn?: string | null;
  sponsorPersonId?: string | null;
  referredByPersonId?: string | null;
  source?: string | null;
  isPrimaryClub?: boolean;
}

export async function createMembership(
  db: TenantDb,
  input: CreateMembershipInput,
  now: string,
  actorUserId: string | null,
): Promise<MembershipRow> {
  const existing = await getMembershipFor(db, input.clubId, input.personId);
  // Re-adding somebody who is already here is almost always a double-submit or
  // a second import pass. Return what's there rather than failing on the
  // unique constraint and losing whatever else the caller was doing.
  if (existing) return existing;

  const id = newId("membership");
  const stage = input.stage ?? "lead";

  await db.insert("memberships", {
    id,
    club_id: input.clubId,
    person_id: input.personId,
    stage,
    membership_type: input.membershipType ?? "active",
    stage_entered_at: now,
    joined_on: input.joinedOn ?? null,
    sponsor_person_id: input.sponsorPersonId ?? null,
    referred_by_person_id: input.referredByPersonId ?? null,
    source: input.source ?? "manual",
    is_primary_club: input.isPrimaryClub === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  });

  await recordStageEvent(db, {
    membershipId: id,
    clubId: input.clubId,
    fromStage: null,
    toStage: stage,
    reason: input.source ?? null,
    actorUserId,
    occurredAt: now,
  });

  const created = await getMembership(db, id);
  if (!created) throw new Error("membership vanished immediately after insert");
  return created;
}

export interface MoveStageInput {
  membershipId: string;
  toStage: Stage;
  reason?: string | null;
  exitReason?: string | null;
  exitNotes?: string | null;
  actorUserId: string | null;
}

/**
 * Move someone along (or out). Writes the event before the row, so a failure
 * mid-way leaves an audit trail rather than a silent change.
 */
export async function moveStage(
  db: TenantDb,
  input: MoveStageInput,
  now: string,
): Promise<MembershipRow | null> {
  const membership = await getMembership(db, input.membershipId);
  if (!membership) return null;
  if (membership.stage === input.toStage) return membership;

  await recordStageEvent(db, {
    membershipId: membership.id,
    clubId: membership.club_id,
    fromStage: membership.stage,
    toStage: input.toStage,
    reason: input.reason ?? null,
    actorUserId: input.actorUserId,
    occurredAt: now,
  });

  const patch: Record<string, unknown> = {
    stage: input.toStage,
    stage_entered_at: now,
    updated_at: now,
  };

  // Becoming a member for the first time stamps the join date.
  if (input.toStage === "active" && !membership.joined_on) {
    patch.joined_on = now.slice(0, 10);
  }

  if ((DEPARTED_STAGES as string[]).includes(input.toStage)) {
    patch.ended_on = now.slice(0, 10);
    patch.exit_reason = input.exitReason ?? null;
    patch.exit_notes = input.exitNotes ?? null;
  } else {
    // Coming back clears the exit — a reactivated member is not a former one.
    patch.ended_on = null;
    patch.exit_reason = null;
    patch.exit_notes = null;
  }

  await db.update("memberships", membership.id, patch);
  return { ...membership, ...patch } as MembershipRow;
}

interface StageEventInput {
  membershipId: string;
  clubId: string;
  fromStage: string | null;
  toStage: string;
  reason: string | null;
  actorUserId: string | null;
  occurredAt: string;
}

export function recordStageEvent(db: TenantDb, e: StageEventInput): Promise<void> {
  return db.insert("membership_stage_events", {
    id: newId("stageEvent"),
    membership_id: e.membershipId,
    club_id: e.clubId,
    from_stage: e.fromStage,
    to_stage: e.toStage,
    reason: e.reason,
    actor_user_id: e.actorUserId,
    occurred_at: e.occurredAt,
  });
}

export interface StageEventRow {
  id: string;
  from_stage: string | null;
  to_stage: string;
  reason: string | null;
  occurred_at: string;
}

export function listStageHistory(db: TenantDb, membershipId: string): Promise<StageEventRow[]> {
  return db.all<StageEventRow>("membership_stage_events", {
    columns: "id, from_stage, to_stage, reason, occurred_at",
    where: "membership_id = ?",
    params: [membershipId],
    orderBy: "occurred_at",
  });
}

export function setSponsorAndMentor(
  db: TenantDb,
  membershipId: string,
  patch: { sponsorPersonId?: string | null; mentorPersonId?: string | null },
  now: string,
): Promise<number> {
  const row: Record<string, unknown> = { updated_at: now };
  if (patch.sponsorPersonId !== undefined) row.sponsor_person_id = patch.sponsorPersonId;
  if (patch.mentorPersonId !== undefined) row.mentor_person_id = patch.mentorPersonId;
  return db.update("memberships", membershipId, row);
}

// ── Counts ────────────────────────────────────────────────────────────────────

export interface ClubCounts {
  active: number;
  pipeline: number;
  atRisk: number;
  onLeave: number;
  departed90d: number;
  joined90d: number;
}

/**
 * One scan for the numbers every club screen wants in its header.
 *
 * Conditional aggregation rather than six UNIONed counts — D1 caps a compound
 * SELECT at five terms, and one pass over the club's memberships is cheaper
 * than six anyway.
 */
export async function clubCounts(db: TenantDb, clubId: string, today: string): Promise<ClubCounts> {
  const ninetyAgo = shiftDays(today, -90);
  const placeholders = PIPELINE_STAGES.map(() => "?").join(",");

  const rows = await db.raw<{
    active: number; pipeline: number; at_risk: number;
    on_leave: number; departed_90d: number; joined_90d: number;
  }>(
    `SELECT
       SUM(CASE WHEN stage IN ('active','at_risk','leave_of_absence') THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN stage IN (${placeholders}) THEN 1 ELSE 0 END) AS pipeline,
       SUM(CASE WHEN stage = 'at_risk' THEN 1 ELSE 0 END) AS at_risk,
       SUM(CASE WHEN stage = 'leave_of_absence' THEN 1 ELSE 0 END) AS on_leave,
       SUM(CASE WHEN ended_on >= ? THEN 1 ELSE 0 END) AS departed_90d,
       SUM(CASE WHEN joined_on >= ? THEN 1 ELSE 0 END) AS joined_90d
     FROM memberships
    WHERE tenant_id = {{tenant}} AND club_id = ?`,
    [...PIPELINE_STAGES, ninetyAgo, ninetyAgo, clubId],
  );

  const r = rows[0];
  return {
    active: Number(r?.active ?? 0),
    pipeline: Number(r?.pipeline ?? 0),
    atRisk: Number(r?.at_risk ?? 0),
    onLeave: Number(r?.on_leave ?? 0),
    departed90d: Number(r?.departed_90d ?? 0),
    joined90d: Number(r?.joined_90d ?? 0),
  };
}

export function shiftDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
