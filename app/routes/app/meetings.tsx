import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/meetings";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { listMeetings, createMeeting } from "@db/services/meetings";
import { shiftDays } from "@db/services/membership";
import { PageHeader, Table, Th, Td, Chip, Empty, Button, Field, Input, Card, formatDate } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Meetings");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("meetings.read");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string }>("clubs", { columns: "id, name" });
  if (!club) return { club: null, meetings: [], canWrite: false };

  const meetings = await listMeetings(db, club.id, {
    from: shiftDays(ctx.today, -120),
    to: shiftDays(ctx.today, 60),
    limit: 60,
  });

  // Attendance counts for the whole page in one query rather than per row.
  const ids = meetings.map((m) => m.id);
  const counts = ids.length
    ? await db.raw<{ meeting_id: string; present: number; guests: number }>(
        `SELECT meeting_id,
                SUM(CASE WHEN status IN ('present','makeup') AND is_guest = 0 THEN 1 ELSE 0 END) AS present,
                SUM(CASE WHEN is_guest = 1 THEN 1 ELSE 0 END) AS guests
           FROM meeting_attendance
          WHERE tenant_id = {{tenant}} AND meeting_id IN (${ids.map(() => "?").join(",")})
          GROUP BY meeting_id`,
        ids,
      )
    : [];
  const byMeeting = new Map(counts.map((c) => [c.meeting_id, c]));

  return {
    club,
    today: ctx.today,
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title,
      date: m.meeting_date,
      startTime: m.start_time,
      location: m.location,
      speaker: m.speaker_name,
      topic: m.speaker_topic,
      cancelled: m.cancelled === 1,
      present: byMeeting.get(m.id)?.present ?? 0,
      guests: byMeeting.get(m.id)?.guests ?? 0,
      recorded: byMeeting.has(m.id),
    })),
    canWrite: ctx.can("meetings.write"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };
  ctx.require("meetings.write", club.id);

  const form = await request.formData();
  const date = String(form.get("meetingDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a date for the meeting." };

  const meeting = await createMeeting(
    db,
    {
      clubId: club.id,
      meetingDate: date,
      title: String(form.get("title") ?? "").trim() || "Meeting",
      startTime: String(form.get("startTime") ?? "") || null,
      location: String(form.get("location") ?? "").trim() || null,
      kind: String(form.get("kind") ?? "regular"),
    },
    ctx.now,
  );

  // Straight to the attendance sheet — creating a meeting is almost always the
  // first half of recording one.
  return redirect(`/app/meetings/${meeting.id}`);
}

export default function Meetings({ loaderData, actionData }: Route.ComponentProps) {
  const { club, meetings, canWrite, today } = loaderData;

  if (!club) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Empty title="No club yet" body="This account isn't attached to a club." />
      </div>
    );
  }

  const upcoming = meetings.filter((m) => m.date >= (today ?? "")).reverse();
  const past = meetings.filter((m) => m.date < (today ?? ""));

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Meetings"
        subtitle="Take attendance in a few seconds — it's what everything else reads from."
      />

      {canWrite && (
        <Card className="mb-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Add a meeting</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            Your weekly meetings are already on the calendar. This is for board meetings,
            socials and anything one-off.
          </p>
          <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-4">
            <Field label="Date" name="meetingDate">
              <Input id="meetingDate" name="meetingDate" type="date" required defaultValue={today} />
            </Field>
            <Field label="Time" name="startTime">
              <Input id="startTime" name="startTime" type="time" defaultValue="12:00" />
            </Field>
            <Field label="What" name="title">
              <Input id="title" name="title" placeholder="Board meeting" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Add
              </Button>
            </div>
          </Form>
          {actionData?.error && <p className="mt-3 text-sm text-risk-500">{actionData.error}</p>}
        </Card>
      )}

      {meetings.length === 0 ? (
        <Empty
          title="Nothing on the calendar"
          body="Add a meeting above, and your weekly series will fill in the rest automatically."
        />
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="pb-8">
              <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
                Coming up
              </h2>
              <MeetingTable meetings={upcoming} />
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
                Already happened
              </h2>
              <MeetingTable meetings={past} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function MeetingTable({ meetings }: { meetings: Route.ComponentProps["loaderData"]["meetings"] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th className="hidden sm:table-cell">Programme</Th>
          <Th>Attendance</Th>
        </tr>
      </thead>
      <tbody>
        {meetings.map((m) => (
          <tr key={m.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
            <Td>
              <Link
                to={`/app/meetings/${m.id}`}
                prefetch="intent"
                className="font-medium text-ink-900 hover:text-brand-600 dark:text-ink-100"
              >
                {formatDate(m.date)}
              </Link>
              <div className="text-xs text-ink-500">
                {[m.title, m.location].filter(Boolean).join(" · ") || "Meeting"}
              </div>
            </Td>
            <Td className="hidden text-ink-600 sm:table-cell dark:text-ink-400">
              {m.topic ? (
                <>
                  {m.topic}
                  {m.speaker && <div className="text-xs text-ink-500">{m.speaker}</div>}
                </>
              ) : (
                "—"
              )}
            </Td>
            <Td>
              {m.cancelled ? (
                <Chip tone="neutral">Cancelled</Chip>
              ) : m.recorded ? (
                <span className="text-ink-700 dark:text-ink-300">
                  {m.present} here
                  {m.guests > 0 && <span className="text-ink-500"> · {m.guests} guest{m.guests === 1 ? "" : "s"}</span>}
                </span>
              ) : (
                // Not "0 present". Nobody marked is a different thing from
                // nobody there, and the difference matters to the scoring.
                <span className="text-ink-500">not taken yet</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
