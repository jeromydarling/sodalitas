/**
 * work.ts — committees and service projects.
 *
 * This is the retention lever a club can actually pull. Attendance tells you
 * somebody is drifting; a committee seat is the thing that stops it. A member
 * doing something is markedly more likely to still be here next year, and it's
 * the one input a president can change this month.
 *
 * So both of these carry participation back into the scoring, and both are
 * built to make adding somebody take one click rather than five.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";
import { logInteraction } from "./interactions";

// ── Committees ────────────────────────────────────────────────────────────────

export interface CommitteeRow {
  id: string;
  club_id: string | null;
  district_id: string | null;
  name: string;
  purpose: string | null;
  goals: string | null;
  meeting_rhythm: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export type CommitteeRole = "chair" | "vice_chair" | "member";

export const COMMITTEE_ROLE_LABELS: Record<CommitteeRole, string> = {
  chair: "Chair",
  vice_chair: "Vice chair",
  member: "Member",
};

/**
 * The committees most Rotary clubs run, offered when a club has none.
 *
 * A blank "create your first committee" screen gets skipped; a list of the five
 * every club already has gets clicked. These match Rotary's own avenues of
 * service closely enough to be recognised without being prescriptive.
 */
export const SUGGESTED_COMMITTEES = [
  { name: "Membership", purpose: "Guests, prospective members, and keeping the people we have." },
  { name: "Service Projects", purpose: "Choosing and running the club's projects." },
  { name: "Foundation", purpose: "Giving, grants, and the club's Foundation relationships." },
  { name: "Public Image", purpose: "The club's public page, press and social." },
  { name: "Programs", purpose: "Speakers and the weekly programme." },
  { name: "Youth Service", purpose: "Interact, Rotaract, exchange and scholarships." },
] as const;

export interface CommitteeWithCount extends CommitteeRow {
  member_count: number;
  chair_name: string | null;
}

export function listCommittees(db: TenantDb, clubId: string): Promise<CommitteeWithCount[]> {
  return db.raw<CommitteeWithCount>(
    `SELECT c.*,
            (SELECT COUNT(*) FROM committee_members cm
              WHERE cm.committee_id = c.id AND cm.tenant_id = {{tenant}}) AS member_count,
            (SELECT p.first_name || ' ' || p.last_name
               FROM committee_members cm
               JOIN people p ON p.id = cm.person_id AND p.tenant_id = {{tenant}}
              WHERE cm.committee_id = c.id AND cm.tenant_id = {{tenant}} AND cm.role = 'chair'
              LIMIT 1) AS chair_name
       FROM committees c
      WHERE c.tenant_id = {{tenant}} AND c.club_id = ? AND c.active = 1
      ORDER BY c.name`,
    [clubId],
  );
}

export interface CommitteeMemberRow {
  id: string;
  person_id: string;
  role: CommitteeRole;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

export function listCommitteeMembers(db: TenantDb, committeeId: string): Promise<CommitteeMemberRow[]> {
  return db.raw<CommitteeMemberRow>(
    `SELECT cm.id, cm.person_id, cm.role, p.first_name, p.last_name, p.preferred_name
       FROM committee_members cm
       JOIN people p ON p.id = cm.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
      WHERE cm.tenant_id = {{tenant}} AND cm.committee_id = ?
      ORDER BY CASE cm.role WHEN 'chair' THEN 0 WHEN 'vice_chair' THEN 1 ELSE 2 END,
               p.last_name, p.first_name`,
    [committeeId],
  );
}

export async function createCommittee(
  db: TenantDb,
  input: { clubId: string; name: string; purpose?: string | null },
  now: string,
): Promise<string> {
  const id = newId("committee");
  await db.insert("committees", {
    id,
    club_id: input.clubId,
    name: input.name.trim(),
    purpose: input.purpose?.trim() || null,
    active: 1,
    created_at: now,
    updated_at: now,
  });
  return id;
}

/**
 * Put somebody on a committee.
 *
 * Logs an interaction, so joining shows on their timeline and counts as the
 * club engaging with them — which is right, because it is.
 */
export async function addCommitteeMember(
  db: TenantDb,
  input: { committeeId: string; clubId: string; personId: string; role?: CommitteeRole },
  now: string,
  actorUserId: string | null,
): Promise<boolean> {
  const existing = await db.first<{ id: string }>("committee_members", {
    columns: "id",
    where: "committee_id = ? AND person_id = ?",
    params: [input.committeeId, input.personId],
  });
  if (existing) return false;

  const committee = await db.byId<CommitteeRow>("committees", input.committeeId);

  await db.insert("committee_members", {
    id: newId("committeeMember"),
    committee_id: input.committeeId,
    person_id: input.personId,
    role: input.role ?? "member",
    starts_on: now.slice(0, 10),
    created_at: now,
  });

  await logInteraction(
    db,
    {
      clubId: input.clubId,
      personId: input.personId,
      kind: "system",
      subject: `Joined the ${committee?.name ?? "committee"} committee`,
      refType: "committee",
      refId: input.committeeId,
      actorUserId,
    },
    now,
  );

  return true;
}

export function removeCommitteeMember(db: TenantDb, id: string, now: string): Promise<number> {
  return db.remove("committee_members", id, now);
}

// ── Projects ──────────────────────────────────────────────────────────────────

export type ProjectStatus = "planned" | "active" | "complete" | "cancelled";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Underway",
  complete: "Finished",
  cancelled: "Cancelled",
};

/** Rotary's seven areas of focus, which grant applications ask for by name. */
export const AREAS_OF_FOCUS = [
  "Peacebuilding and Conflict Prevention",
  "Disease Prevention and Treatment",
  "Water, Sanitation and Hygiene",
  "Maternal and Child Health",
  "Basic Education and Literacy",
  "Community Economic Development",
  "Environment",
] as const;

export interface ProjectRow {
  id: string;
  club_id: string | null;
  name: string;
  slug: string | null;
  summary: string | null;
  description: string | null;
  area_of_focus: string | null;
  status: ProjectStatus;
  starts_on: string | null;
  ends_on: string | null;
  budget_cents: number;
  spent_cents: number;
  volunteer_slots: number | null;
  people_served: number | null;
  outcome_notes: string | null;
  is_public: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithParticipation extends ProjectRow {
  volunteer_count: number;
  total_hours: number;
}

export function listProjects(db: TenantDb, clubId: string): Promise<ProjectWithParticipation[]> {
  return db.raw<ProjectWithParticipation>(
    `SELECT pr.*,
            (SELECT COUNT(*) FROM project_participants pp
              WHERE pp.project_id = pr.id AND pp.tenant_id = {{tenant}}) AS volunteer_count,
            (SELECT COALESCE(SUM(pp.hours), 0) FROM project_participants pp
              WHERE pp.project_id = pr.id AND pp.tenant_id = {{tenant}}) AS total_hours
       FROM projects pr
      WHERE pr.tenant_id = {{tenant}} AND pr.club_id = ?
      ORDER BY CASE pr.status
                 WHEN 'active' THEN 0 WHEN 'planned' THEN 1
                 WHEN 'complete' THEN 2 ELSE 3 END,
               pr.starts_on DESC`,
    [clubId],
  );
}

export interface ParticipantRow {
  id: string;
  person_id: string;
  role: string;
  hours: number;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

export function listParticipants(db: TenantDb, projectId: string): Promise<ParticipantRow[]> {
  return db.raw<ParticipantRow>(
    `SELECT pp.id, pp.person_id, pp.role, pp.hours,
            p.first_name, p.last_name, p.preferred_name
       FROM project_participants pp
       JOIN people p ON p.id = pp.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
      WHERE pp.tenant_id = {{tenant}} AND pp.project_id = ?
      ORDER BY CASE pp.role WHEN 'lead' THEN 0 ELSE 1 END, p.last_name`,
    [projectId],
  );
}

export async function createProject(
  db: TenantDb,
  input: {
    clubId: string;
    name: string;
    summary?: string | null;
    areaOfFocus?: string | null;
    status?: ProjectStatus;
    startsOn?: string | null;
    endsOn?: string | null;
    budgetCents?: number;
  },
  now: string,
): Promise<string> {
  const id = newId("project");
  await db.insert("projects", {
    id,
    club_id: input.clubId,
    name: input.name.trim(),
    slug: slugify(input.name),
    summary: input.summary?.trim() || null,
    area_of_focus: input.areaOfFocus || null,
    status: input.status ?? "planned",
    starts_on: input.startsOn || null,
    ends_on: input.endsOn || null,
    // Integer cents, like every other amount in the product.
    budget_cents: input.budgetCents ?? 0,
    spent_cents: 0,
    is_public: 1,
    is_shared: 0,
    created_at: now,
    updated_at: now,
  });
  return id;
}

export async function addParticipant(
  db: TenantDb,
  input: { projectId: string; clubId: string; personId: string; role?: string },
  now: string,
  actorUserId: string | null,
): Promise<boolean> {
  const existing = await db.first<{ id: string }>("project_participants", {
    columns: "id",
    where: "project_id = ? AND person_id = ?",
    params: [input.projectId, input.personId],
  });
  if (existing) return false;

  const project = await db.byId<ProjectRow>("projects", input.projectId);

  await db.insert("project_participants", {
    id: newId("participant"),
    project_id: input.projectId,
    person_id: input.personId,
    club_id: input.clubId,
    role: input.role ?? "volunteer",
    signed_up_at: now,
    hours: 0,
    created_at: now,
  });

  await logInteraction(
    db,
    {
      clubId: input.clubId,
      personId: input.personId,
      kind: "signup",
      subject: `Signed up for ${project?.name ?? "a project"}`,
      refType: "project",
      refId: input.projectId,
      actorUserId,
    },
    now,
  );

  return true;
}

/**
 * Log volunteer hours.
 *
 * Set rather than added: a club correcting a number expects the correction to
 * stick, and hours are usually entered once at the end from a sign-in sheet
 * rather than accumulated shift by shift.
 */
export function setHours(db: TenantDb, participantId: string, hours: number): Promise<number> {
  return db.update("project_participants", participantId, {
    hours: Math.max(0, Math.round(hours * 10) / 10),
  });
}

export function removeParticipant(db: TenantDb, id: string, now: string): Promise<number> {
  return db.remove("project_participants", id, now);
}

export function updateProject(
  db: TenantDb,
  id: string,
  patch: Partial<{
    status: ProjectStatus;
    summary: string | null;
    outcomeNotes: string | null;
    peopleServed: number | null;
    spentCents: number;
    endsOn: string | null;
    isPublic: boolean;
  }>,
  now: string,
): Promise<number> {
  const row: Record<string, unknown> = { updated_at: now };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.outcomeNotes !== undefined) row.outcome_notes = patch.outcomeNotes;
  if (patch.peopleServed !== undefined) row.people_served = patch.peopleServed;
  if (patch.spentCents !== undefined) row.spent_cents = patch.spentCents;
  if (patch.endsOn !== undefined) row.ends_on = patch.endsOn;
  if (patch.isPublic !== undefined) row.is_public = patch.isPublic ? 1 : 0;
  return db.update("projects", id, row);
}

/**
 * Members not yet involved in anything.
 *
 * The list a president actually wants: not "who's at risk" but "who could I
 * ask". Ordered by longest-serving first, because a twenty-year member nobody
 * has asked in a decade is both the easiest yes and the quietest loss.
 */
export function membersNotInvolved(
  db: TenantDb,
  clubId: string,
  today: string,
  limit = 20,
): Promise<{ person_id: string; first_name: string; last_name: string; joined_on: string | null }[]> {
  return db.raw(
    `SELECT p.id AS person_id, p.first_name, p.last_name, m.joined_on
       FROM memberships m
       JOIN people p ON p.id = m.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
      WHERE m.tenant_id = {{tenant}} AND m.club_id = ?
        AND m.stage IN ('active','at_risk')
        AND NOT EXISTS (
          SELECT 1 FROM committee_members cm
            JOIN committees c ON c.id = cm.committee_id AND c.tenant_id = {{tenant}}
           WHERE cm.tenant_id = {{tenant}} AND cm.person_id = p.id
             AND c.club_id = ? AND c.active = 1
             AND (cm.ends_on IS NULL OR cm.ends_on >= ?))
        AND NOT EXISTS (
          SELECT 1 FROM project_participants pp
            JOIN projects pr ON pr.id = pp.project_id AND pr.tenant_id = {{tenant}}
           WHERE pp.tenant_id = {{tenant}} AND pp.person_id = p.id
             AND pr.club_id = ? AND pr.status IN ('planned','active'))
      ORDER BY m.joined_on
      LIMIT ?`,
    [clubId, clubId, today, clubId, limit],
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "project"
  );
}
