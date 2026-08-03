/**
 * interactions.ts — the touchpoint spine, and tasks.
 *
 * Every inbound and outbound event lands in `interactions`: a call, a reply, a
 * meeting attended, a stage move, a gift, a form submission. It is append-only.
 * The person timeline reads from it, the engagement scoring derives "days since
 * anyone actually spoke to them" from it, and nothing edits it after the fact.
 *
 * That last property is what makes a club's history survive its own leadership
 * turnover, which is the whole point.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";

export type InteractionKind =
  | "call"
  | "email_out"
  | "email_in"
  | "meeting"
  | "attendance"
  | "note"
  | "stage_change"
  | "gift"
  | "signup"
  | "rsvp"
  | "task_done"
  | "system";

/** How each kind reads on a timeline. */
export const INTERACTION_LABELS: Record<InteractionKind, string> = {
  call: "Call",
  email_out: "Email sent",
  email_in: "Email received",
  meeting: "Met",
  attendance: "Attended",
  note: "Note",
  stage_change: "Stage change",
  gift: "Gift",
  signup: "Signed up",
  rsvp: "RSVP",
  task_done: "Task completed",
  system: "Recorded",
};

/**
 * Which kinds count as a human being in touch.
 *
 * Attendance is deliberately excluded. Someone sitting in a room is not
 * someone who has been spoken to, and conflating the two is exactly how a club
 * convinces itself it's connected to a member who is quietly on their way out.
 */
export const HUMAN_TOUCH_KINDS: InteractionKind[] = ["call", "email_out", "meeting", "note"];

export interface InteractionRow {
  id: string;
  club_id: string | null;
  person_id: string | null;
  organization_id: string | null;
  kind: InteractionKind;
  source_module: string;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  signal_weight: number;
  ref_type: string | null;
  ref_id: string | null;
  actor_user_id: string | null;
  is_private: number;
  occurred_at: string;
  created_at: string;
}

export interface LogInput {
  clubId?: string | null;
  personId?: string | null;
  organizationId?: string | null;
  kind: InteractionKind;
  subject?: string | null;
  body?: string | null;
  outcome?: string | null;
  refType?: string | null;
  refId?: string | null;
  actorUserId?: string | null;
  /** Private notes stay with the person who wrote them. */
  isPrivate?: boolean;
  sourceModule?: string;
  /** Defaults to now. Set when back-filling from an import. */
  occurredAt?: string;
}

export async function logInteraction(db: TenantDb, input: LogInput, now: string): Promise<string> {
  const id = newId("interaction");
  await db.insert("interactions", {
    id,
    club_id: input.clubId ?? null,
    person_id: input.personId ?? null,
    organization_id: input.organizationId ?? null,
    kind: input.kind,
    source_module: input.sourceModule ?? "app",
    subject: input.subject?.slice(0, 300) ?? null,
    body: input.body ?? null,
    outcome: input.outcome ?? null,
    signal_weight: HUMAN_TOUCH_KINDS.includes(input.kind) ? 1 : 0.5,
    ref_type: input.refType ?? null,
    ref_id: input.refId ?? null,
    actor_user_id: input.actorUserId ?? null,
    is_private: input.isPrivate ? 1 : 0,
    occurred_at: input.occurredAt ?? now,
    created_at: now,
  });
  return id;
}

export interface TimelineEntry extends InteractionRow {
  actor_name: string | null;
}

/**
 * A person's history with the club.
 *
 * Private notes are filtered by author rather than hidden entirely, so a
 * membership chair's candid note about a difficult conversation doesn't turn up
 * in front of the whole board — but its author can still find it.
 */
export function personTimeline(
  db: TenantDb,
  personId: string,
  viewerUserId: string | null,
  limit = 100,
): Promise<TimelineEntry[]> {
  return db.raw<TimelineEntry>(
    `SELECT i.*, u.display_name AS actor_name
       FROM interactions i
       LEFT JOIN users u ON u.id = i.actor_user_id
      WHERE i.tenant_id = {{tenant}}
        AND i.person_id = ?
        AND (i.is_private = 0 OR i.actor_user_id = ?)
      ORDER BY i.occurred_at DESC
      LIMIT ?`,
    [personId, viewerUserId, limit],
  );
}

/** Days since anyone had a real conversation. Null when there never was one. */
export async function daysSinceLastTouch(
  db: TenantDb,
  personId: string,
  today: string,
): Promise<number | null> {
  const rows = await db.all<{ occurred_at: string }>("interactions", {
    columns: "occurred_at",
    where: `person_id = ? AND kind IN (${HUMAN_TOUCH_KINDS.map(() => "?").join(",")})`,
    params: [personId, ...HUMAN_TOUCH_KINDS],
    orderBy: "occurred_at DESC",
    limit: 1,
  });
  const last = rows[0]?.occurred_at;
  if (!last) return null;
  const diff = Date.parse(`${today}T00:00:00Z`) - Date.parse(last);
  return Math.max(0, Math.floor(diff / 86_400_000));
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface TaskRow {
  id: string;
  club_id: string | null;
  title: string;
  details: string | null;
  assignee_user_id: string | null;
  assignee_person_id: string | null;
  subject_person_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  due_on: string | null;
  status: "open" | "done" | "dismissed";
  priority: string;
  origin: "manual" | "signal" | "automation" | "import";
  origin_ref: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  clubId?: string | null;
  title: string;
  details?: string | null;
  assigneeUserId?: string | null;
  subjectPersonId?: string | null;
  dueOn?: string | null;
  priority?: string;
  origin?: TaskRow["origin"];
  originRef?: string | null;
  createdBy?: string | null;
}

export async function createTask(
  db: TenantDb,
  input: CreateTaskInput,
  now: string,
): Promise<string> {
  const id = newId("task");
  await db.insert("tasks", {
    id,
    club_id: input.clubId ?? null,
    title: input.title.trim().slice(0, 300),
    details: input.details ?? null,
    assignee_user_id: input.assigneeUserId ?? null,
    subject_person_id: input.subjectPersonId ?? null,
    due_on: input.dueOn ?? null,
    status: "open",
    priority: input.priority ?? "normal",
    origin: input.origin ?? "manual",
    origin_ref: input.originRef ?? null,
    created_by: input.createdBy ?? null,
    created_at: now,
    updated_at: now,
  });
  return id;
}

/**
 * Create a task from a signal, unless one is already open for the same thing.
 *
 * The guard is why the weekly job can run every Monday without stacking up
 * duplicate reminders about the same drifting member.
 */
export async function createTaskFromSignal(
  db: TenantDb,
  input: CreateTaskInput & { originRef: string },
  now: string,
): Promise<string | null> {
  const existing = await db.first<{ id: string }>("tasks", {
    columns: "id",
    where: "origin = 'signal' AND origin_ref = ? AND status = 'open'",
    params: [input.originRef],
  });
  if (existing) return null;
  return createTask(db, { ...input, origin: "signal" }, now);
}

export interface TaskWithSubject extends TaskRow {
  subject_first: string | null;
  subject_last: string | null;
  assignee_name: string | null;
}

export function listOpenTasks(
  db: TenantDb,
  opts: { clubId?: string | null; assigneeUserId?: string | null; limit?: number } = {},
): Promise<TaskWithSubject[]> {
  const clauses = ["t.tenant_id = {{tenant}}", "t.status = 'open'"];
  const params: unknown[] = [];
  if (opts.clubId) {
    clauses.push("t.club_id = ?");
    params.push(opts.clubId);
  }
  if (opts.assigneeUserId) {
    clauses.push("t.assignee_user_id = ?");
    params.push(opts.assigneeUserId);
  }
  params.push(opts.limit ?? 100);

  return db.raw<TaskWithSubject>(
    `SELECT t.*, p.first_name AS subject_first, p.last_name AS subject_last,
            u.display_name AS assignee_name
       FROM tasks t
       LEFT JOIN people p ON p.id = t.subject_person_id AND p.tenant_id = {{tenant}}
       LEFT JOIN users u ON u.id = t.assignee_user_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY t.due_on IS NULL, t.due_on, t.created_at
      LIMIT ?`,
    params,
  );
}

/** Does this person already have somebody on the case? */
export async function hasOpenTaskFor(db: TenantDb, personId: string): Promise<boolean> {
  const row = await db.first<{ id: string }>("tasks", {
    columns: "id",
    where: "subject_person_id = ? AND status = 'open'",
    params: [personId],
  });
  return row !== null;
}

/** Person ids with an open task, in one query. Used by the weekly signal job. */
export async function peopleWithOpenTasks(db: TenantDb, clubId: string): Promise<Set<string>> {
  const rows = await db.all<{ subject_person_id: string }>("tasks", {
    columns: "subject_person_id",
    where: "club_id = ? AND status = 'open' AND subject_person_id IS NOT NULL",
    params: [clubId],
    limit: 1000,
  });
  return new Set(rows.map((r) => r.subject_person_id));
}

/**
 * Close a task. Completing one writes an interaction, so "somebody called Bill"
 * shows on Bill's timeline and counts as a touch for the scoring — otherwise a
 * club could do all the right things and still look neglectful.
 */
export async function completeTask(
  db: TenantDb,
  id: string,
  actorUserId: string | null,
  now: string,
): Promise<boolean> {
  const task = await db.byId<TaskRow>("tasks", id);
  if (!task || task.status !== "open") return false;

  await db.update("tasks", id, { status: "done", completed_at: now, updated_at: now });

  if (task.subject_person_id) {
    await logInteraction(
      db,
      {
        clubId: task.club_id,
        personId: task.subject_person_id,
        kind: "task_done",
        subject: task.title,
        actorUserId,
        refType: "task",
        refId: id,
      },
      now,
    );
  }
  return true;
}

export function dismissTask(db: TenantDb, id: string, now: string): Promise<number> {
  return db.update("tasks", id, { status: "dismissed", updated_at: now });
}
