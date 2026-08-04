import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/events";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { createEvent, listEvents, listRegistrations } from "@db/services/events";
import { seatsSold } from "@domain/events";
import { EVENT_FEE_SUMMARY } from "@domain/pricing";
import {
  Button,
  Card,
  Chip,
  Empty,
  Field,
  Input,
  PageHeader,
  Table,
  Td,
  Th,
  formatDate,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Events");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("events.read");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string }>("clubs", { columns: "id, name" });
  if (!club) return { club: null, events: [], canWrite: false, today: ctx.today };

  const events = await listEvents(db, club.id, { limit: 60 });

  // Seat counts for every event on the page in one pass rather than a query per
  // row. `seatsSold` rather than a COUNT so a table of eight counts as eight,
  // and so an unpaid hold that has expired stops occupying a seat the moment
  // it should.
  const ids = events.map((e) => e.id);
  const counts = new Map<string, { sold: number; waitlist: number; unpaid: number }>();
  if (ids.length) {
    const rows = await db.all<{
      event_id: string;
      status: string;
      seats: number;
      registered_at: string;
    }>("event_registrations", {
      columns: "event_id, status, seats, registered_at",
      where: `event_id IN (${ids.map(() => "?").join(",")})`,
      params: ids,
      limit: 5000,
    });
    for (const id of ids) {
      const mine = rows.filter((r) => r.event_id === id);
      counts.set(id, {
        sold: seatsSold(
          mine.map((r) => ({
            status: r.status as never,
            seats: r.seats,
            registeredAt: r.registered_at,
          })),
          ctx.now,
        ),
        waitlist: mine.filter((r) => r.status === "waitlist").length,
        unpaid: mine.filter((r) => r.status === "pending").length,
      });
    }
  }

  return {
    club,
    today: ctx.today,
    canWrite: ctx.can("events.write", club.id),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      startsOn: e.starts_on,
      startsAtTime: e.starts_at_time,
      location: e.location,
      status: e.status,
      visibility: e.visibility,
      capacity: e.capacity,
      sold: counts.get(e.id)?.sold ?? 0,
      waitlist: counts.get(e.id)?.waitlist ?? 0,
      unpaid: counts.get(e.id)?.unpaid ?? 0,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };
  ctx.require("events.write", club.id);

  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim();
  const startsOn = String(form.get("startsOn") ?? "");
  if (!title) return { error: "Give the event a name." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return { error: "Pick a date." };

  const event = await createEvent(
    db,
    {
      clubId: club.id,
      title,
      startsOn,
      startsAtTime: String(form.get("startsAtTime") ?? "") || null,
      location: String(form.get("location") ?? "").trim() || null,
      capacity: numberOrNull(form.get("capacity")),
    },
    ctx.now,
    ctx.user?.id ?? null,
  );

  // Straight into the event. It starts as a draft with no tickets, and the
  // next decision — what a place costs — is the one that matters.
  return redirect(`/app/events/${event.id}`);
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export default function Events({ loaderData, actionData }: Route.ComponentProps) {
  const { club, events, canWrite, today } = loaderData;

  if (!club) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Empty title="No club yet" body="This account isn't attached to a club." />
      </div>
    );
  }

  const upcoming = events.filter((e) => e.startsOn >= today);
  const past = events.filter((e) => e.startsOn < today);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Events"
        subtitle="Take registrations and money for club events — and have who came count towards the people you're watching."
      />

      {canWrite && (
        <Card className="mb-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">New event</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            It starts as a draft. Nothing is public and nobody can register until you set
            the tickets and publish it.
          </p>
          <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Field label="What" name="title">
                <Input id="title" name="title" placeholder="Charity auction" required />
              </Field>
            </div>
            <Field label="Date" name="startsOn">
              <Input id="startsOn" name="startsOn" type="date" required defaultValue={today} />
            </Field>
            <Field label="Time" name="startsAtTime">
              <Input id="startsAtTime" name="startsAtTime" type="time" defaultValue="18:00" />
            </Field>
            <Field label="Seats" name="capacity" hint="Blank for unlimited">
              <Input id="capacity" name="capacity" type="number" min="1" inputMode="numeric" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Create
              </Button>
            </div>
          </Form>
          {actionData?.error && <p className="mt-3 text-sm text-risk-500">{actionData.error}</p>}
        </Card>
      )}

      {events.length === 0 ? (
        <Empty
          title="No events yet"
          body={
            canWrite
              ? `Create one above. What we charge for it: ${EVENT_FEE_SUMMARY}`
              : "Nothing is on the calendar yet."
          }
        />
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="pb-8">
              <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
                Coming up
              </h2>
              <EventTable events={upcoming} />
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
                Already happened
              </h2>
              <EventTable events={past} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

type EventItem = Route.ComponentProps["loaderData"]["events"][number];

function EventTable({ events }: { events: EventItem[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Event</Th>
          <Th className="hidden sm:table-cell">Status</Th>
          <Th>Registered</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id} className="hover:bg-ink-50 dark:hover:bg-ink-800/40">
            <Td>
              <Link
                to={`/app/events/${e.id}`}
                prefetch="intent"
                className="-my-1.5 block py-1.5 font-medium text-ink-900 hover:text-brand-600 dark:text-ink-100"
              >
                {e.title}
              </Link>
              <div className="text-xs text-ink-500">
                {[formatDate(e.startsOn), e.startsAtTime, e.location].filter(Boolean).join(" · ")}
              </div>
            </Td>
            <Td className="hidden sm:table-cell">
              <StatusChip status={e.status} visibility={e.visibility} />
            </Td>
            <Td>
              <Seats
                sold={e.sold}
                capacity={e.capacity}
                waitlist={e.waitlist}
                unpaid={e.unpaid}
              />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function StatusChip({ status, visibility }: { status: string; visibility: string }) {
  if (status === "cancelled") return <Chip tone="risk">Cancelled</Chip>;
  if (status === "draft") return <Chip tone="neutral">Draft</Chip>;
  if (status === "closed") return <Chip tone="neutral">Closed</Chip>;
  return visibility === "members" ? <Chip tone="watch">Members only</Chip> : <Chip tone="steady">Open</Chip>;
}

function Seats({
  sold,
  capacity,
  waitlist,
  unpaid,
}: {
  sold: number;
  capacity: number | null;
  waitlist: number;
  unpaid: number;
}) {
  if (sold === 0 && waitlist === 0) return <span className="text-ink-500">nobody yet</span>;
  return (
    <span className="text-ink-700 dark:text-ink-300">
      {capacity === null ? `${sold}` : `${sold} of ${capacity}`}
      {waitlist > 0 && <span className="text-ink-500"> · {waitlist} waiting</span>}
      {/* Named rather than folded into the total. A held seat that nobody has
          paid for is a different fact from a sold one, and a treasurer
          reconciling on the night needs to see the difference. */}
      {unpaid > 0 && <span className="text-ink-500"> · {unpaid} unpaid</span>}
    </span>
  );
}
