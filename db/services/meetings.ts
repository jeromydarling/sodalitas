/**
 * meetings.ts — meetings, attendance and makeups.
 *
 * Rotary runs on cadence, so this has to be quick. Attendance capture is the
 * one screen a club secretary uses every single week for years, and every extra
 * click is one they pay fifty times a year. It defaults to "everyone present"
 * and asks them to mark the absences, because that's the shorter list.
 *
 * Attendance also feeds the retention scoring, which means a club that finds
 * this tedious stops recording, and a club that stops recording loses the one
 * feature it's paying for. Speed here is a retention feature.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";
import { shiftDays } from "./membership";

export interface MeetingRow {
  id: string;
  club_id: string;
  series_id: string | null;
  title: string | null;
  meeting_date: string;
  start_time: string | null;
  location: string | null;
  kind: string;
  speaker_person_id: string | null;
  speaker_name: string | null;
  speaker_topic: string | null;
  speaker_bio: string | null;
  agenda: string | null;
  notes: string | null;
  recap: string | null;
  recap_status: "none" | "draft" | "approved";
  meal_count: number | null;
  is_public: number;
  cancelled: number;
  created_at: string;
  updated_at: string;
}

export type AttendanceStatus =
  | "present"
  | "absent"
  | "excused"
  | "makeup"
  | "rsvp_yes"
  | "rsvp_no";

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: "Here",
  absent: "Away",
  excused: "Excused",
  makeup: "Makeup",
  rsvp_yes: "Coming",
  rsvp_no: "Can't make it",
};

/** Statuses that count towards a club's attendance rate. */
export const PRESENT_STATUSES: AttendanceStatus[] = ["present", "makeup"];

export interface AttendanceRow {
  id: string;
  meeting_id: string;
  club_id: string;
  person_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  status: AttendanceStatus;
  is_guest: number;
  host_person_id: string | null;
  makeup_note: string | null;
  created_at: string;
}

// ── Reading ───────────────────────────────────────────────────────────────────

export function getMeeting(db: TenantDb, id: string): Promise<MeetingRow | null> {
  return db.byId<MeetingRow>("meetings", id);
}

export function listMeetings(
  db: TenantDb,
  clubId: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): Promise<MeetingRow[]> {
  const clauses = ["club_id = ?"];
  const params: unknown[] = [clubId];
  if (opts.from) {
    clauses.push("meeting_date >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push("meeting_date <= ?");
    params.push(opts.to);
  }
  return db.all<MeetingRow>("meetings", {
    where: clauses.join(" AND "),
    params,
    orderBy: "meeting_date DESC, start_time DESC",
    limit: opts.limit ?? 100,
  });
}

export function nextMeeting(db: TenantDb, clubId: string, today: string): Promise<MeetingRow | null> {
  return db.first<MeetingRow>("meetings", {
    where: "club_id = ? AND meeting_date >= ? AND cancelled = 0",
    params: [clubId, today],
    orderBy: "meeting_date, start_time",
  });
}

export interface AttendanceLine {
  personId: string | null;
  name: string;
  status: AttendanceStatus | null;
  isGuest: boolean;
  guestEmail: string | null;
  hostName: string | null;
  attendanceId: string | null;
}

/**
 * The capture sheet: every current member plus anyone already marked, with
 * whatever's been recorded so far.
 *
 * A member with no row yet comes back with `status: null` rather than being
 * omitted — the screen needs to show them so they can be marked, and the
 * distinction between "marked absent" and "not yet marked" matters when a
 * secretary is interrupted halfway through.
 */
export async function attendanceSheet(
  db: TenantDb,
  meetingId: string,
  clubId: string,
): Promise<AttendanceLine[]> {
  const [members, marked] = await Promise.all([
    db.raw<{ id: string; first_name: string; last_name: string; preferred_name: string | null }>(
      `SELECT p.id, p.first_name, p.last_name, p.preferred_name
         FROM people p
         JOIN memberships m ON m.person_id = p.id AND m.tenant_id = {{tenant}}
        WHERE p.tenant_id = {{tenant}}
          AND p.deleted_at IS NULL
          AND m.club_id = ?
          AND m.stage IN ('active','at_risk','leave_of_absence')
        ORDER BY p.last_name, p.first_name`,
      [clubId],
    ),
    db.raw<AttendanceRow & { host_first: string | null; host_last: string | null }>(
      `SELECT a.*, h.first_name AS host_first, h.last_name AS host_last
         FROM meeting_attendance a
         LEFT JOIN people h ON h.id = a.host_person_id AND h.tenant_id = {{tenant}}
        WHERE a.tenant_id = {{tenant}} AND a.meeting_id = ?`,
      [meetingId],
    ),
  ]);

  const byPerson = new Map(marked.filter((m) => m.person_id).map((m) => [m.person_id!, m]));
  const lines: AttendanceLine[] = members.map((p) => {
    const rec = byPerson.get(p.id);
    return {
      personId: p.id,
      name: `${p.preferred_name || p.first_name} ${p.last_name}`,
      status: (rec?.status as AttendanceStatus) ?? null,
      isGuest: false,
      guestEmail: null,
      hostName: null,
      attendanceId: rec?.id ?? null,
    };
  });

  // Guests are appended rather than merged in, so the member list stays in a
  // stable order week to week and a secretary's eye can find a name by muscle
  // memory.
  for (const g of marked.filter((m) => m.is_guest === 1)) {
    lines.push({
      personId: g.person_id,
      name: g.guest_name ?? "Guest",
      status: g.status as AttendanceStatus,
      isGuest: true,
      guestEmail: g.guest_email,
      hostName: g.host_first ? `${g.host_first} ${g.host_last ?? ""}`.trim() : null,
      attendanceId: g.id,
    });
  }

  return lines;
}

// ── Writing ───────────────────────────────────────────────────────────────────

export interface CreateMeetingInput {
  clubId: string;
  seriesId?: string | null;
  title?: string | null;
  meetingDate: string;
  startTime?: string | null;
  location?: string | null;
  kind?: string;
  speakerName?: string | null;
  speakerTopic?: string | null;
  isPublic?: boolean;
}

export async function createMeeting(
  db: TenantDb,
  input: CreateMeetingInput,
  now: string,
): Promise<MeetingRow> {
  const id = newId("meeting");
  await db.insert("meetings", {
    id,
    club_id: input.clubId,
    series_id: input.seriesId ?? null,
    title: input.title ?? null,
    meeting_date: input.meetingDate,
    start_time: input.startTime ?? null,
    location: input.location ?? null,
    kind: input.kind ?? "regular",
    speaker_name: input.speakerName ?? null,
    speaker_topic: input.speakerTopic ?? null,
    recap_status: "none",
    is_public: input.isPublic === false ? 0 : 1,
    cancelled: 0,
    created_at: now,
    updated_at: now,
  });
  const created = await getMeeting(db, id);
  if (!created) throw new Error("meeting vanished immediately after insert");
  return created;
}

export interface MarkAttendanceInput {
  meetingId: string;
  clubId: string;
  marks: { personId: string; status: AttendanceStatus }[];
  recordedBy: string | null;
}

/**
 * Record attendance for a meeting.
 *
 * Replaces the whole sheet in one batch rather than diffing: the sheet is the
 * truth as of the moment it was saved, and a secretary who unchecks someone
 * expects that to stick. Batching keeps it to one round trip, which matters —
 * a 90-member club would otherwise be 90 sequential writes on a Worker.
 */
export async function markAttendance(
  db: TenantDb,
  input: MarkAttendanceInput,
  now: string,
): Promise<number> {
  const raw = db.unsafeDb;
  const statements = [
    // Clear only the member rows; guest rows are added individually and must
    // survive a re-save of the member sheet.
    raw
      .prepare(
        `DELETE FROM meeting_attendance
          WHERE tenant_id = ? AND meeting_id = ? AND is_guest = 0`,
      )
      .bind(db.tenantId, input.meetingId),
    ...input.marks.map((m) =>
      raw
        .prepare(
          `INSERT INTO meeting_attendance
             (id, tenant_id, meeting_id, club_id, person_id, status, is_guest, recorded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(
          newId("attendance"),
          db.tenantId,
          input.meetingId,
          input.clubId,
          m.personId,
          m.status,
          input.recordedBy,
          now,
        ),
    ),
  ];

  await db.batch(statements);
  return input.marks.length;
}

export interface AddGuestInput {
  meetingId: string;
  clubId: string;
  name: string;
  email?: string | null;
  hostPersonId?: string | null;
  /** Set when the guest already exists as a person. */
  personId?: string | null;
}

/** Sign a guest in at the door. */
export async function addGuest(
  db: TenantDb,
  input: AddGuestInput,
  now: string,
  recordedBy: string | null,
): Promise<string> {
  const id = newId("attendance");
  await db.insert("meeting_attendance", {
    id,
    meeting_id: input.meetingId,
    club_id: input.clubId,
    person_id: input.personId ?? null,
    guest_name: input.name.trim(),
    guest_email: input.email?.trim() || null,
    status: "present",
    is_guest: 1,
    host_person_id: input.hostPersonId ?? null,
    recorded_by: recordedBy,
    created_at: now,
  });
  return id;
}

/** Log a makeup: attendance at another club, or a project, that counts. */
export function logMakeup(
  db: TenantDb,
  input: { meetingId: string; clubId: string; personId: string; note: string },
  now: string,
  recordedBy: string | null,
): Promise<void> {
  return db.insert("meeting_attendance", {
    id: newId("attendance"),
    meeting_id: input.meetingId,
    club_id: input.clubId,
    person_id: input.personId,
    status: "makeup",
    is_guest: 0,
    makeup_note: input.note.trim(),
    recorded_by: recordedBy,
    created_at: now,
  });
}

export function updateMeeting(
  db: TenantDb,
  id: string,
  patch: Partial<{
    title: string | null;
    location: string | null;
    speakerName: string | null;
    speakerTopic: string | null;
    speakerBio: string | null;
    agenda: string | null;
    notes: string | null;
    recap: string | null;
    recapStatus: MeetingRow["recap_status"];
    mealCount: number | null;
    cancelled: boolean;
  }>,
  now: string,
): Promise<number> {
  const row: Record<string, unknown> = { updated_at: now };
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.location !== undefined) row.location = patch.location;
  if (patch.speakerName !== undefined) row.speaker_name = patch.speakerName;
  if (patch.speakerTopic !== undefined) row.speaker_topic = patch.speakerTopic;
  if (patch.speakerBio !== undefined) row.speaker_bio = patch.speakerBio;
  if (patch.agenda !== undefined) row.agenda = patch.agenda;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.recap !== undefined) row.recap = patch.recap;
  if (patch.recapStatus !== undefined) row.recap_status = patch.recapStatus;
  if (patch.mealCount !== undefined) row.meal_count = patch.mealCount;
  if (patch.cancelled !== undefined) row.cancelled = patch.cancelled ? 1 : 0;
  return db.update("meetings", id, row);
}

// ── Recurrence ────────────────────────────────────────────────────────────────

export interface SeriesRow {
  id: string;
  club_id: string;
  name: string;
  rrule_weekday: number | null;
  rrule_interval: number;
  start_time: string | null;
  duration_min: number;
  location: string | null;
  active: number;
}

/**
 * Dates a series falls on between two dates, inclusive.
 *
 * Deliberately simple: weekly or every-N-weeks on one weekday covers nearly
 * every Rotary club, and a full RRULE implementation would be a lot of code to
 * support the handful that meet on "the second Tuesday". Those clubs can add
 * meetings by hand until it's worth building properly.
 */
export function seriesDates(
  series: Pick<SeriesRow, "rrule_weekday" | "rrule_interval">,
  from: string,
  to: string,
): string[] {
  if (series.rrule_weekday === null) return [];
  const interval = Math.max(1, series.rrule_interval);
  const out: string[] = [];

  const start = new Date(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end)) return [];

  // Advance to the first matching weekday on or after `from`.
  const delta = (series.rrule_weekday - start.getUTCDay() + 7) % 7;
  start.setUTCDate(start.getUTCDate() + delta);

  let guard = 0;
  while (start.getTime() <= end && guard++ < 500) {
    out.push(start.toISOString().slice(0, 10));
    start.setUTCDate(start.getUTCDate() + 7 * interval);
  }
  return out;
}

/**
 * Create any missing meetings for a series over a window.
 *
 * Idempotent: existing dates are left alone, so this is safe to run from a cron
 * and safe to run twice.
 */
export async function materializeSeries(
  db: TenantDb,
  series: SeriesRow,
  from: string,
  to: string,
  now: string,
): Promise<number> {
  const wanted = seriesDates(series, from, to);
  if (wanted.length === 0) return 0;

  const existing = await db.all<{ meeting_date: string }>("meetings", {
    columns: "meeting_date",
    where: `series_id = ? AND meeting_date >= ? AND meeting_date <= ?`,
    params: [series.id, from, to],
  });
  const have = new Set(existing.map((e) => e.meeting_date));
  const missing = wanted.filter((d) => !have.has(d));
  if (missing.length === 0) return 0;

  const raw = db.unsafeDb;
  await db.batch(
    missing.map((date) =>
      raw
        .prepare(
          `INSERT INTO meetings
             (id, tenant_id, club_id, series_id, title, meeting_date, start_time,
              location, kind, recap_status, is_public, cancelled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'regular', 'none', 1, 0, ?, ?)`,
        )
        .bind(
          newId("meeting"),
          db.tenantId,
          series.club_id,
          series.id,
          series.name,
          date,
          series.start_time,
          series.location,
          now,
          now,
        ),
    ),
  );
  return missing.length;
}

/** Keep a rolling window of scheduled meetings ahead of every active series. */
export async function materializeAllSeries(
  db: TenantDb,
  today: string,
  now: string,
  weeksAhead = 12,
): Promise<number> {
  const series = await db.all<SeriesRow>("meeting_series", { where: "active = 1" });
  let created = 0;
  for (const s of series) {
    created += await materializeSeries(db, s, today, shiftDays(today, weeksAhead * 7), now);
  }
  return created;
}
