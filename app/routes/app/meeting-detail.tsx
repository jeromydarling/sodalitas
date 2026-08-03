import { Form, Link, data, useNavigation } from "react-router";
import type { Route } from "./+types/meeting-detail";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import {
  getMeeting, attendanceSheet, markAttendance, addGuest, updateMeeting,
  ATTENDANCE_LABELS, type AttendanceStatus,
} from "@db/services/meetings";
import { findOrCreatePerson } from "@db/services/people";
import { createMembership } from "@db/services/membership";
import { logInteraction } from "@db/services/interactions";
import { PageHeader, Card, Button, Field, Input, Chip, formatDate } from "~/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return appMeta(loaderData ? `Attendance — ${formatDate(loaderData.meeting.date)}` : "Meeting");
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("meetings.read");
  const db = ctx.db();

  const meeting = await getMeeting(db, params.meetingId);
  if (!meeting) throw data("No such meeting in this club.", { status: 404 });

  const sheet = await attendanceSheet(db, meeting.id, meeting.club_id);

  return {
    meeting: {
      id: meeting.id,
      date: meeting.meeting_date,
      title: meeting.title,
      location: meeting.location,
      speaker: meeting.speaker_name,
      topic: meeting.speaker_topic,
      notes: meeting.notes,
      recorded: sheet.some((l) => l.status !== null),
    },
    sheet,
    canRecord: ctx.can("attendance.record", meeting.club_id),
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();

  const meeting = await getMeeting(db, params.meetingId);
  if (!meeting) throw data("No such meeting in this club.", { status: 404 });
  ctx.require("attendance.record", meeting.club_id);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "attendance");

  if (intent === "guest") {
    const name = String(form.get("guestName") ?? "").trim();
    if (!name) return { error: "What's their name?" };
    const email = String(form.get("guestEmail") ?? "").trim() || null;

    // A guest becomes a person straight away, so their second visit lands on
    // the same record and the follow-up signal has somebody to name. A guest
    // who exists only as a line on one attendance sheet is a guest nobody
    // follows up.
    const parts = name.split(/\s+/);
    const { person } = await findOrCreatePerson(
      db,
      {
        firstName: parts[0]!,
        lastName: parts.slice(1).join(" ") || "—",
        email,
        role: "guest",
      },
      ctx.now,
    );

    await createMembership(
      db,
      { clubId: meeting.club_id, personId: person.id, stage: "guest_attended", source: "event" },
      ctx.now,
      ctx.user?.id ?? null,
    );

    await addGuest(
      db,
      {
        meetingId: meeting.id,
        clubId: meeting.club_id,
        name,
        email,
        personId: person.id,
        hostPersonId: String(form.get("hostPersonId") ?? "") || null,
      },
      ctx.now,
      ctx.user?.id ?? null,
    );

    await logInteraction(
      db,
      {
        clubId: meeting.club_id,
        personId: person.id,
        kind: "attendance",
        subject: `Visited on ${meeting.meeting_date}`,
        refType: "meeting",
        refId: meeting.id,
        actorUserId: ctx.user?.id ?? null,
      },
      ctx.now,
    );

    return { ok: true, guestAdded: name };
  }

  if (intent === "notes") {
    await updateMeeting(
      db,
      meeting.id,
      {
        speakerName: String(form.get("speakerName") ?? "").trim() || null,
        speakerTopic: String(form.get("speakerTopic") ?? "").trim() || null,
        notes: String(form.get("notes") ?? "").trim() || null,
      },
      ctx.now,
    );
    return { ok: true };
  }

  // The sheet is the truth as of the moment it was saved: everyone not marked
  // absent is present. Defaulting the other way would mean a secretary has to
  // tick eighty boxes to record an ordinary week.
  const absent = new Set(form.getAll("absent").map(String));
  const excused = new Set(form.getAll("excused").map(String));
  const sheet = await attendanceSheet(db, meeting.id, meeting.club_id);

  const marks = sheet
    .filter((l) => l.personId && !l.isGuest)
    .map((l) => ({
      personId: l.personId!,
      status: (excused.has(l.personId!)
        ? "excused"
        : absent.has(l.personId!)
          ? "absent"
          : "present") as AttendanceStatus,
    }));

  await markAttendance(
    db,
    { meetingId: meeting.id, clubId: meeting.club_id, marks, recordedBy: ctx.user?.id ?? null },
    ctx.now,
  );

  return { ok: true, saved: marks.filter((m) => m.status === "present").length };
}

export default function MeetingDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { meeting, sheet, canRecord } = loaderData;
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  const members = sheet.filter((l) => !l.isGuest);
  const guests = sheet.filter((l) => l.isGuest);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link to="/app/meetings" prefetch="intent" className="text-sm text-ink-500 hover:text-ink-800">
        ← Meetings
      </Link>

      <PageHeader
        title={formatDate(meeting.date)}
        subtitle={[meeting.title, meeting.location].filter(Boolean).join(" · ") || undefined}
        action={meeting.recorded ? <Chip tone="steady">Attendance taken</Chip> : undefined}
      />

      {actionData?.saved !== undefined && (
        <p className="mb-6 rounded-lg bg-steady-500/12 px-4 py-3 text-sm text-steady-500">
          Saved — {actionData.saved} here.
        </p>
      )}
      {actionData?.guestAdded && (
        <p className="mb-6 rounded-lg bg-steady-500/12 px-4 py-3 text-sm text-steady-500">
          {actionData.guestAdded} is on the list. We'll remind someone to follow up.
        </p>
      )}

      {canRecord && (
        <Card className="mb-6">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Who wasn't here?</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            Everyone's marked here by default — just tick the people who weren't. It's the
            shorter list.
          </p>

          <Form method="post" className="mt-5">
            <input type="hidden" name="intent" value="attendance" />
            <ul className="divide-y divide-ink-100 dark:divide-ink-800/60">
              {members.map((line) => (
                <li key={line.personId} className="flex items-center justify-between gap-4 py-2">
                  <span className="text-sm text-ink-800 dark:text-ink-200">{line.name}</span>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <label className="flex items-center gap-1.5 text-ink-600 dark:text-ink-400">
                      <input
                        type="checkbox"
                        name="absent"
                        value={line.personId ?? ""}
                        defaultChecked={line.status === "absent"}
                        className="rounded border-ink-300"
                      />
                      Away
                    </label>
                    <label className="flex items-center gap-1.5 text-ink-600 dark:text-ink-400">
                      <input
                        type="checkbox"
                        name="excused"
                        value={line.personId ?? ""}
                        defaultChecked={line.status === "excused"}
                        className="rounded border-ink-300"
                      />
                      Excused
                    </label>
                  </div>
                </li>
              ))}
            </ul>
            <Button type="submit" disabled={busy} className="mt-5">
              {busy ? "Saving…" : "Save attendance"}
            </Button>
          </Form>
        </Card>
      )}

      {/* ── Guests ── */}
      <Card className="mb-6">
        <h2 className="font-medium text-ink-900 dark:text-ink-100">Guests</h2>
        {guests.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-sm">
            {guests.map((g) => (
              <li key={g.attendanceId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-ink-800 dark:text-ink-200">{g.name}</span>
                {g.hostName && <span className="text-xs text-ink-500">guest of {g.hostName}</span>}
              </li>
            ))}
          </ul>
        )}

        {canRecord && (
          <Form method="post" className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input type="hidden" name="intent" value="guest" />
            <Field label="Name" name="guestName">
              <Input id="guestName" name="guestName" required placeholder="Their name" />
            </Field>
            <Field label="Email" name="guestEmail" hint="So somebody can follow up.">
              <Input id="guestEmail" name="guestEmail" type="email" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary">
                Sign in
              </Button>
            </div>
          </Form>
        )}
      </Card>

      {/* ── Programme and notes ── */}
      {canRecord && (
        <Card>
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Programme</h2>
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="notes" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Speaker" name="speakerName">
                <Input id="speakerName" name="speakerName" defaultValue={meeting.speaker ?? ""} />
              </Field>
              <Field label="Topic" name="speakerTopic">
                <Input id="speakerTopic" name="speakerTopic" defaultValue={meeting.topic ?? ""} />
              </Field>
            </div>
            <Field label="Notes" name="notes">
              <textarea
                id="notes"
                name="notes"
                rows={3}
                defaultValue={meeting.notes ?? ""}
                className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
              />
            </Field>
            <Button type="submit" variant="secondary">
              Save
            </Button>
          </Form>
        </Card>
      )}
    </div>
  );
}
