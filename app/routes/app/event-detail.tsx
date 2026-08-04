/**
 * event-detail.tsx — one event: what it costs, who's coming, and the door.
 *
 * Three jobs on one page because they are three moments in the same evening
 * and splitting them across routes would mean somebody standing at the door
 * with a phone navigating between tabs. The check-in box is first on the page
 * once the event has started, for the same reason.
 */

import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/event-detail";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import {
  addTicketType,
  availability,
  cancelRegistration,
  checkIn,
  closeAttendance,
  eventById,
  findByTicketCode,
  listRegistrations,
  listTicketTypes,
  updateEvent,
} from "@db/services/events";
import { EVENT_FEE_SUMMARY, EVENT_FEE } from "@domain/pricing";
import { platformFee } from "@domain/events";
import {
  Button,
  ButtonLink,
  Card,
  Chip,
  Empty,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  formatDate,
  money,
} from "~/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return appMeta(loaderData?.event.title ?? "Event");
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("events.read");
  const db = ctx.db();

  const event = await eventById(db, params.eventId);
  if (!event) throw new Response("Not found", { status: 404 });

  const [types, registrations, avail, club] = await Promise.all([
    listTicketTypes(db, event.id),
    listRegistrations(db, event.id),
    availability(db, event, ctx.now),
    db.first<{ id: string; slug: string }>("clubs", { columns: "id, slug" }),
  ]);

  // What the club actually keeps, and what we take, on the money confirmed so
  // far. Shown rather than derivable, because a treasurer who has to work out
  // our cut from a rate is a treasurer who will assume the worst.
  const paid = registrations.filter((r) => r.status !== "cancelled" && r.status !== "waitlist");
  const grossCents = paid.reduce((s, r) => s + r.charged_cents, 0);
  const feeCents = paid.reduce((s, r) => s + r.platform_fee_cents, 0);

  return {
    event: {
      id: event.id,
      slug: event.slug,
      title: event.title,
      summary: event.summary,
      startsOn: event.starts_on,
      startsAtTime: event.starts_at_time,
      location: event.location,
      status: event.status,
      visibility: event.visibility,
      capacity: event.capacity,
      waitlist: event.waitlist === 1,
      registrationClosesOn: event.registration_closes_on,
    },
    clubSlug: club?.slug ?? null,
    today: ctx.today,
    started: event.starts_on <= ctx.today,
    availability: avail,
    money: { grossCents, feeCents, netCents: grossCents - feeCents },
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      priceCents: t.price_cents,
      capacity: t.capacity,
      seatsEach: t.seats_each,
      membersOnly: t.members_only === 1,
      active: t.active === 1,
    })),
    registrations: registrations.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      personId: r.person_id,
      status: r.status,
      seats: r.seats,
      guests: r.guests,
      chargedCents: r.charged_cents,
      ticketCode: r.ticket_code,
      checkedIn: r.checked_in_at !== null,
      waitlistPosition: r.waitlist_position,
    })),
    canWrite: ctx.can("events.write", event.club_id),
    canCheckIn: ctx.can("events.check_in", event.club_id),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();

  const event = await eventById(db, params.eventId);
  if (!event) return { error: "That event no longer exists." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // The door is a lower bar than the office on purpose: whoever is marking
  // people in should not also need permission to change the price.
  if (intent === "checkIn" || intent === "checkInByCode") {
    ctx.require("events.check_in", event.club_id);

    let registrationId = String(form.get("registrationId") ?? "");
    if (intent === "checkInByCode") {
      const found = await findByTicketCode(db, event.id, String(form.get("code") ?? ""));
      if (!found) return { error: "No booking with that code. Try their name in the list below." };
      registrationId = found.id;
    }

    const result = await checkIn(db, registrationId, ctx.now, ctx.user?.id ?? null);
    if (!result.ok) return { error: "That booking has gone." };
    return { ok: true, message: result.alreadyIn ? "Already marked in." : "Marked in." };
  }

  ctx.require("events.write", event.club_id);

  if (intent === "addTicket") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "Name the ticket — 'Member', 'Guest', 'Table of eight'." };
    await addTicketType(
      db,
      {
        eventId: event.id,
        name,
        priceCents: dollarsToCents(form.get("price")),
        capacity: positiveOrNull(form.get("capacity")),
        seatsEach: Number(form.get("seatsEach") ?? 1) || 1,
        membersOnly: form.get("membersOnly") === "on",
      },
      ctx.now,
    );
    return { ok: true, message: "Ticket added." };
  }

  if (intent === "publish") {
    const types = await listTicketTypes(db, event.id);
    // Publishing an event with no tickets produces a public page with nothing
    // to click. Refuse rather than ship a dead end.
    if (types.length === 0) {
      return { error: "Add at least one ticket type first — even a free one." };
    }
    await updateEvent(db, event.id, { status: "open", published_at: ctx.now }, ctx.now);
    return { ok: true, message: "Open for registrations." };
  }

  if (intent === "close") {
    await updateEvent(db, event.id, { status: "closed" }, ctx.now);
    return { ok: true, message: "Registrations closed." };
  }

  if (intent === "cancelEvent") {
    // Cancelled, not deleted. An event that simply vanishes leaves people
    // turning up to a locked hall.
    await updateEvent(db, event.id, { status: "cancelled" }, ctx.now);
    return { ok: true, message: "Cancelled. The page stays up and says so." };
  }

  if (intent === "cancelRegistration") {
    const { promoted } = await cancelRegistration(
      db,
      String(form.get("registrationId") ?? ""),
      ctx.now,
    );
    return {
      ok: true,
      message: promoted.length
        ? `Cancelled. ${promoted.length} ${promoted.length === 1 ? "person" : "people"} moved off the waiting list — let them know.`
        : "Cancelled.",
    };
  }

  if (intent === "closeAttendance") {
    const { attended, noShows } = await closeAttendance(db, event.id, ctx.now);
    return {
      ok: true,
      message: `${attended} came, ${noShows} booked and didn't. Both are on their record now.`,
    };
  }

  if (intent === "settings") {
    await updateEvent(
      db,
      event.id,
      {
        title: String(form.get("title") ?? event.title).trim().slice(0, 200) || event.title,
        summary: String(form.get("summary") ?? "").trim().slice(0, 500) || null,
        location: String(form.get("location") ?? "").trim() || null,
        capacity: positiveOrNull(form.get("capacity")),
        visibility: form.get("visibility") === "members" ? "members" : "public",
        waitlist: form.get("waitlist") === "on" ? 1 : 0,
        registration_closes_on: String(form.get("closesOn") ?? "") || null,
      },
      ctx.now,
    );
    return { ok: true, message: "Saved." };
  }

  return { error: "We didn't recognise that." };
}

function dollarsToCents(value: FormDataEntryValue | null): number {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function positiveOrNull(value: FormDataEntryValue | null): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export default function EventDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    event,
    types,
    registrations,
    availability: avail,
    money: totals,
    canWrite,
    canCheckIn,
    started,
    clubSlug,
  } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const coming = registrations.filter((r) => r.status === "confirmed" || r.status === "attended");
  const waiting = registrations.filter((r) => r.status === "waitlist");
  const unpaid = registrations.filter((r) => r.status === "pending");
  const gone = registrations.filter((r) => r.status === "cancelled" || r.status === "no_show");
  const checkedIn = registrations.filter((r) => r.checkedIn).length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title={event.title}
        subtitle={[formatDate(event.startsOn), event.startsAtTime, event.location]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to="/app/events" className="text-sm text-ink-500 hover:text-brand-600">
          ← All events
        </Link>
        {event.status === "open" && clubSlug && event.visibility === "public" && (
          <ButtonLink to={`/club/${clubSlug}/events/${event.slug}`} variant="quiet">
            View the public page
          </ButtonLink>
        )}
      </div>

      {actionData?.error && (
        <p className="mb-6 rounded-lg bg-risk-50 px-4 py-3 text-sm text-risk-600 dark:bg-risk-900/20">
          {actionData.error}
        </p>
      )}
      {actionData?.ok && actionData.message && (
        <p className="mb-6 rounded-lg bg-steady-50 px-4 py-3 text-sm text-steady-600 dark:bg-steady-900/20">
          {actionData.message}
        </p>
      )}

      {/* The door, first, once the day has arrived. */}
      {started && canCheckIn && event.status !== "draft" && (
        <Card className="mb-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">At the door</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            {checkedIn} of {coming.length} in. Type a ticket code, or use the list below.
          </p>
          <Form method="post" className="mt-4 flex gap-3">
            <input type="hidden" name="intent" value="checkInByCode" />
            <Input
              name="code"
              placeholder="A7K2M9"
              autoCapitalize="characters"
              autoComplete="off"
              className="max-w-40 font-mono tracking-widest uppercase"
              aria-label="Ticket code"
            />
            <Button type="submit" disabled={busy}>
              Mark in
            </Button>
          </Form>
        </Card>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Registered"
          value={event.capacity === null ? String(avail.sold) : `${avail.sold} of ${event.capacity}`}
          note={avail.waitlistCount > 0 ? `${avail.waitlistCount} on the waiting list` : undefined}
        />
        <Stat label="Taken" value={money(totals.grossCents)} note="Paid registrations" />
        <Stat
          label="The club keeps"
          value={money(totals.netCents)}
          // Said plainly, on the page, before anybody asks. A fee somebody has
          // to calculate is a fee they will assume is bigger than it is.
          note={totals.feeCents > 0 ? `Our fee: ${money(totals.feeCents)}` : "No fee on free tickets"}
        />
      </div>

      {/* ── Tickets ── */}
      <section className="mb-10">
        <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">Tickets</h2>
        {types.length === 0 ? (
          <Empty
            title="No tickets yet"
            body="Add at least one — a free ticket is fine, and it's what lets people register at all."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ticket</Th>
                <Th>Price</Th>
                <Th className="hidden sm:table-cell">Seats each</Th>
                <Th className="hidden sm:table-cell">Our fee</Th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <span className="font-medium text-ink-900 dark:text-ink-100">{t.name}</span>
                    {t.membersOnly && <span className="ml-2 text-xs text-ink-500">members only</span>}
                  </Td>
                  <Td>{t.priceCents === 0 ? "Free" : money(t.priceCents)}</Td>
                  <Td className="hidden sm:table-cell">{t.seatsEach}</Td>
                  <Td className="hidden text-ink-500 sm:table-cell">
                    {t.priceCents === 0 ? "—" : money(platformFee(t.priceCents, EVENT_FEE))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {canWrite && (
          <Card className="mt-4">
            <Form method="post" className="grid gap-4 sm:grid-cols-6">
              <input type="hidden" name="intent" value="addTicket" />
              <div className="sm:col-span-2">
                <Field label="Ticket name" name="name">
                  <Input id="name" name="name" placeholder="Member" required />
                </Field>
              </div>
              <Field label="Price" name="price" hint="0 for free">
                <Input id="price" name="price" inputMode="decimal" placeholder="35" />
              </Field>
              <Field label="Seats each" name="seatsEach" hint="8 for a table">
                <Input id="seatsEach" name="seatsEach" type="number" min="1" defaultValue="1" />
              </Field>
              <Field label="Limit" name="capacity" hint="Blank = event limit">
                <Input id="capacity" name="capacity" type="number" min="1" />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={busy} className="w-full">
                  Add
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-600 sm:col-span-6 dark:text-ink-400">
                <input type="checkbox" name="membersOnly" className="rounded" />
                Members only
              </label>
            </Form>
            <p className="mt-3 text-xs text-ink-500">{EVENT_FEE_SUMMARY}</p>
          </Card>
        )}
      </section>

      {/* ── Who's coming ── */}
      <section className="mb-10">
        <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
          Coming ({coming.reduce((s, r) => s + r.seats, 0)} seats)
        </h2>
        {coming.length === 0 ? (
          <Empty title="Nobody yet" body="Registrations land here as they come in." />
        ) : (
          <RegistrationTable
            rows={coming}
            canWrite={canWrite}
            canCheckIn={canCheckIn}
            busy={busy}
            showCheckIn
          />
        )}
      </section>

      {unpaid.length > 0 && (
        <section className="mb-10">
          <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
            Started paying, not finished
          </h2>
          <p className="pb-3 text-sm text-ink-600 dark:text-ink-400">
            These hold a seat for twenty minutes and then release it on their own. Nothing
            has been charged.
          </p>
          <RegistrationTable rows={unpaid} canWrite={canWrite} canCheckIn={false} busy={busy} />
        </section>
      )}

      {waiting.length > 0 && (
        <section className="mb-10">
          <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
            Waiting list
          </h2>
          <p className="pb-3 text-sm text-ink-600 dark:text-ink-400">
            Nobody here has been charged. They move up automatically the moment somebody
            cancels — you'll want to tell them.
          </p>
          <RegistrationTable rows={waiting} canWrite={canWrite} canCheckIn={false} busy={busy} />
        </section>
      )}

      {gone.length > 0 && (
        <section className="mb-10">
          <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">
            Cancelled and no-shows
          </h2>
          <RegistrationTable rows={gone} canWrite={false} canCheckIn={false} busy={busy} />
        </section>
      )}

      {/* ── The evening's last action ── */}
      {canWrite && started && coming.length > 0 && (
        <Card className="mb-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Close the door list</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            Everybody still marked as coming becomes a no-show. That's the point: somebody
            who booked and didn't come is a different thing from somebody who never booked,
            and it's the first thing the retention score wants to know.
          </p>
          <Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="closeAttendance" />
            <Button type="submit" variant="secondary" disabled={busy}>
              Close attendance
            </Button>
          </Form>
        </Card>
      )}

      {/* ── Settings ── */}
      {canWrite && (
        <section>
          <h2 className="pb-3 text-sm font-medium tracking-wide text-ink-500 uppercase">Settings</h2>
          <Card>
            <Form method="post" className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="intent" value="settings" />
              <div className="sm:col-span-2">
                <Field label="Name" name="title">
                  <Input id="title" name="title" defaultValue={event.title} required />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="One line for the public page" name="summary">
                  <Input id="summary" name="summary" defaultValue={event.summary ?? ""} />
                </Field>
              </div>
              <Field label="Where" name="location">
                <Input id="location" name="location" defaultValue={event.location ?? ""} />
              </Field>
              <Field label="Seats" name="capacity" hint="Blank for unlimited">
                <Input
                  id="capacity"
                  name="capacity"
                  type="number"
                  min="1"
                  defaultValue={event.capacity ?? ""}
                />
              </Field>
              <Field label="Who can see it" name="visibility">
                <Select id="visibility" name="visibility" defaultValue={event.visibility}>
                  <option value="public">Anyone — listed on the club's website</option>
                  <option value="members">Members only — not listed publicly</option>
                </Select>
              </Field>
              <Field label="Registration closes" name="closesOn" hint="Blank = right up to the day">
                <Input
                  id="closesOn"
                  name="closesOn"
                  type="date"
                  defaultValue={event.registrationClosesOn ?? ""}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink-600 sm:col-span-2 dark:text-ink-400">
                <input
                  type="checkbox"
                  name="waitlist"
                  defaultChecked={event.waitlist}
                  className="rounded"
                />
                Keep a waiting list once it's full
              </label>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
              </div>
            </Form>
          </Card>

          <div className="mt-4 flex flex-wrap gap-3">
            {event.status === "draft" && (
              <Form method="post">
                <input type="hidden" name="intent" value="publish" />
                <Button type="submit" disabled={busy}>
                  Open for registrations
                </Button>
                {/* Said here, at the moment the club commits to selling
                    something, rather than only on a pricing page they read
                    once. Nobody should find out what we take after the money
                    has moved. */}
                {types.some((t) => t.priceCents > 0) && (
                  <p className="mt-2 max-w-md text-xs text-ink-500">
                    Payments go to your club's own Stripe account. On paid tickets Sodalitas
                    takes {EVENT_FEE_SUMMARY.charAt(0).toLowerCase() + EVENT_FEE_SUMMARY.slice(1)}{" "}
                    It's shown to the payer before they pay, and recorded on every registration.
                  </p>
                )}
              </Form>
            )}
            {event.status === "open" && (
              <Form method="post">
                <input type="hidden" name="intent" value="close" />
                <Button type="submit" variant="secondary" disabled={busy}>
                  Stop taking registrations
                </Button>
              </Form>
            )}
            {event.status !== "cancelled" && (
              <Form method="post">
                <input type="hidden" name="intent" value="cancelEvent" />
                <Button type="submit" variant="quiet" disabled={busy}>
                  Cancel the event
                </Button>
              </Form>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <div className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink-900 dark:text-ink-100">{value}</div>
      {note && <div className="mt-1 text-xs text-ink-500">{note}</div>}
    </Card>
  );
}

type Registration = Route.ComponentProps["loaderData"]["registrations"][number];

function RegistrationTable({
  rows,
  canWrite,
  canCheckIn,
  busy,
  showCheckIn = false,
}: {
  rows: Registration[];
  canWrite: boolean;
  canCheckIn: boolean;
  busy: boolean;
  showCheckIn?: boolean;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Who</Th>
          <Th className="hidden sm:table-cell">Seats</Th>
          <Th className="hidden sm:table-cell">Paid</Th>
          <Th>{showCheckIn ? "Door" : "Status"}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>
              {r.personId ? (
                <Link
                  to={`/app/people/${r.personId}`}
                  prefetch="intent"
                  className="font-medium text-ink-900 hover:text-brand-600 dark:text-ink-100"
                >
                  {r.name}
                </Link>
              ) : (
                <span className="font-medium text-ink-900 dark:text-ink-100">{r.name}</span>
              )}
              <div className="text-xs text-ink-500">
                {r.email}
                <span className="ml-2 font-mono tracking-wider">{r.ticketCode}</span>
              </div>
            </Td>
            <Td className="hidden sm:table-cell">
              {r.seats}
              {r.guests > 0 && (
                <span className="text-xs text-ink-500"> · {r.guests} guest{r.guests === 1 ? "" : "s"}</span>
              )}
            </Td>
            <Td className="hidden sm:table-cell">
              {r.chargedCents === 0 ? <span className="text-ink-500">Free</span> : money(r.chargedCents)}
            </Td>
            <Td>
              <div className="flex items-center gap-2">
                {r.checkedIn ? (
                  <Chip tone="steady">In</Chip>
                ) : r.status === "waitlist" ? (
                  <Chip tone="watch">
                    {r.waitlistPosition ? `#${r.waitlistPosition} waiting` : "Waiting"}
                  </Chip>
                ) : r.status === "pending" ? (
                  <Chip tone="neutral">Unpaid</Chip>
                ) : r.status === "no_show" ? (
                  <Chip tone="risk">Didn't come</Chip>
                ) : r.status === "cancelled" ? (
                  <Chip tone="neutral">Cancelled</Chip>
                ) : showCheckIn && canCheckIn ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="checkIn" />
                    <input type="hidden" name="registrationId" value={r.id} />
                    <Button type="submit" variant="quiet" disabled={busy}>
                      Mark in
                    </Button>
                  </Form>
                ) : (
                  <Chip tone="steady">Coming</Chip>
                )}
                {canWrite && r.status !== "cancelled" && r.status !== "no_show" && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="cancelRegistration" />
                    <input type="hidden" name="registrationId" value={r.id} />
                    <button
                      type="submit"
                      disabled={busy}
                      className="text-xs text-ink-500 underline-offset-2 hover:text-risk-500 hover:underline"
                    >
                      cancel
                    </button>
                  </Form>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
