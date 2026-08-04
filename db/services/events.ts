/**
 * events.ts — running an event, and remembering who came.
 *
 * The second half of that sentence is the point. Every club system has an
 * events module; all of them are islands. A registration here writes an
 * interaction against the person, counts as involvement in the engagement
 * score, and leaves a no-show behind as evidence the retention engine can
 * read. See `recordEngagement` at the bottom — it is the smallest function in
 * the file and the reason the feature exists.
 *
 * ## Holding a seat without a transaction
 *
 * D1 has no interactive transactions, so "check capacity then insert" is a
 * race: two people can both read 79 of 80 taken and both be confirmed. The
 * shape used here is the same one `claimEvent` uses for webhooks — write
 * first, verify after:
 *
 *   1. Insert the registration as `pending`, which holds seats immediately.
 *   2. Re-count seats *including* the row just written.
 *   3. If the room is oversold, move this row — the one that lost — to the
 *      waitlist or cancel it.
 *
 * The loser is always the later insert because the count is ordered by
 * `registered_at`, so the outcome is stable and doesn't depend on which
 * request happened to be re-counted first.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";
import {
  checkOrder, priceOrder, promoteFromWaitlist, seatsSold, newTicketCode,
  normaliseTicketCode, validateAnswers, eventSlug, isQuestionKind,
  type TicketType, type OrderLine, type SeatHolder, type Question,
  type RegistrationStatus,
} from "@domain/events";
import { logInteraction, type InteractionKind } from "./interactions";

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface EventRow {
  id: string;
  club_id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  starts_on: string;
  starts_at_time: string | null;
  ends_on: string | null;
  ends_at_time: string | null;
  timezone: string | null;
  location: string | null;
  address: string | null;
  map_url: string | null;
  cover_media_id: string | null;
  status: "draft" | "open" | "closed" | "cancelled";
  visibility: "public" | "members";
  capacity: number | null;
  waitlist: number;
  allow_guests: number;
  max_guests: number;
  registration_opens_on: string | null;
  registration_closes_on: string | null;
  refund_policy: string | null;
  project_id: string | null;
  committee_id: string | null;
  published_at: string | null;
}

export interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  capacity: number | null;
  seats_each: number;
  max_per_order: number;
  members_only: number;
  sort_order: number;
  active: number;
}

export interface RegistrationRow {
  id: string;
  event_id: string;
  club_id: string;
  person_id: string | null;
  name: string;
  email: string;
  phone: string | null;
  status: RegistrationStatus;
  seats: number;
  guests: number;
  guest_names: string | null;
  answers_json: string | null;
  notes: string | null;
  amount_cents: number;
  covered_fee_cents: number;
  platform_fee_cents: number;
  charged_cents: number;
  refunded_cents: number;
  checkout_id: string | null;
  ticket_code: string;
  waitlist_position: number | null;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  checked_in_at: string | null;
}

// ── Reading ───────────────────────────────────────────────────────────────────

export async function listEvents(
  db: TenantDb,
  clubId: string,
  opts: { from?: string; status?: string; limit?: number } = {},
): Promise<EventRow[]> {
  const clauses = ["club_id = ?"];
  const params: unknown[] = [clubId];
  if (opts.from) {
    clauses.push("(ends_on >= ? OR (ends_on IS NULL AND starts_on >= ?))");
    params.push(opts.from, opts.from);
  }
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  return db.all<EventRow>("events", {
    where: clauses.join(" AND "),
    params,
    orderBy: opts.from ? "starts_on ASC" : "starts_on DESC",
    limit: opts.limit ?? 100,
  });
}

export function eventById(db: TenantDb, id: string): Promise<EventRow | null> {
  return db.byId<EventRow>("events", id);
}

export function eventBySlug(db: TenantDb, clubId: string, slug: string): Promise<EventRow | null> {
  return db.first<EventRow>("events", { where: "club_id = ? AND slug = ?", params: [clubId, slug] });
}

export function listTicketTypes(db: TenantDb, eventId: string): Promise<TicketTypeRow[]> {
  return db.all<TicketTypeRow>("event_ticket_types", {
    where: "event_id = ?",
    params: [eventId],
    orderBy: "sort_order ASC, created_at ASC",
  });
}

export function listQuestions(db: TenantDb, eventId: string): Promise<
  { id: string; label: string; help: string | null; kind: string; options_json: string | null; required: number }[]
> {
  return db.all("event_questions", {
    where: "event_id = ?",
    params: [eventId],
    orderBy: "sort_order ASC",
  });
}

export function listRegistrations(
  db: TenantDb,
  eventId: string,
  opts: { status?: RegistrationStatus } = {},
): Promise<RegistrationRow[]> {
  const clauses = ["event_id = ?"];
  const params: unknown[] = [eventId];
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  return db.all<RegistrationRow>("event_registrations", {
    where: clauses.join(" AND "),
    params,
    orderBy: "registered_at ASC",
    limit: 1000,
  });
}

/** The shape domain/events.ts wants, from the shape the database keeps. */
export function toTicketTypes(rows: TicketTypeRow[]): TicketType[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceCents: r.price_cents,
    capacity: r.capacity,
    seatsEach: Math.max(1, r.seats_each),
    maxPerOrder: Math.max(1, r.max_per_order),
    membersOnly: r.members_only === 1,
    active: r.active === 1,
  }));
}

export function toQuestions(
  rows: { id: string; label: string; kind: string; options_json: string | null; required: number }[],
): Question[] {
  return rows.map((r) => {
    let options: string[] = [];
    try {
      const parsed = r.options_json ? JSON.parse(r.options_json) : [];
      if (Array.isArray(parsed)) options = parsed.filter((o): o is string => typeof o === "string");
    } catch {
      options = [];
    }
    return {
      id: r.id,
      label: r.label,
      kind: isQuestionKind(r.kind) ? r.kind : "text",
      options,
      required: r.required === 1,
    };
  });
}

function toHolders(rows: RegistrationRow[]): SeatHolder[] {
  return rows.map((r) => ({ status: r.status, seats: r.seats, registeredAt: r.registered_at }));
}

/** Seats sold per ticket type, for the per-type capacity check. */
export async function soldByType(db: TenantDb, eventId: string): Promise<Record<string, number>> {
  const rows = await db.raw<{ ticket_type_id: string; seats: number }>(
    `SELECT i.ticket_type_id, SUM(i.quantity * i.seats_each) AS seats
       FROM event_registration_items i
       JOIN event_registrations r
         ON r.id = i.registration_id AND r.tenant_id = {{tenant}}
      WHERE i.tenant_id = {{tenant}}
        AND r.event_id = ?
        AND r.status IN ('confirmed','attended','no_show')
      GROUP BY i.ticket_type_id`,
    [eventId],
  );
  return Object.fromEntries(rows.map((r) => [r.ticket_type_id, r.seats]));
}

/** What a public page shows about how full an event is. */
export async function availability(
  db: TenantDb,
  event: EventRow,
  now: string,
): Promise<{ sold: number; remaining: number | null; full: boolean; waitlistCount: number }> {
  const regs = await listRegistrations(db, event.id);
  const sold = seatsSold(toHolders(regs), now);
  const remaining = event.capacity === null ? null : Math.max(0, event.capacity - sold);
  return {
    sold,
    remaining,
    full: remaining !== null && remaining === 0,
    waitlistCount: regs.filter((r) => r.status === "waitlist").length,
  };
}

// ── Writing an event ──────────────────────────────────────────────────────────

export interface CreateEventInput {
  clubId: string;
  title: string;
  startsOn: string;
  startsAtTime?: string | null;
  endsOn?: string | null;
  endsAtTime?: string | null;
  location?: string | null;
  summary?: string | null;
  capacity?: number | null;
  visibility?: "public" | "members";
  timezone?: string | null;
}

export async function createEvent(
  db: TenantDb,
  input: CreateEventInput,
  now: string,
  userId: string | null,
): Promise<EventRow> {
  const id = newId("event");
  const slug = await uniqueSlug(db, input.clubId, eventSlug(input.title, input.startsOn));

  await db.insert("events", {
    id,
    club_id: input.clubId,
    slug,
    title: input.title.trim().slice(0, 200),
    summary: input.summary ?? null,
    starts_on: input.startsOn,
    starts_at_time: input.startsAtTime ?? null,
    ends_on: input.endsOn ?? null,
    ends_at_time: input.endsAtTime ?? null,
    timezone: input.timezone ?? null,
    location: input.location ?? null,
    status: "draft",
    visibility: input.visibility ?? "public",
    capacity: input.capacity ?? null,
    waitlist: 1,
    allow_guests: 1,
    max_guests: 4,
    created_by: userId,
    created_at: now,
    updated_at: now,
  });

  return (await eventById(db, id))!;
}

async function uniqueSlug(db: TenantDb, clubId: string, base: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db.first<{ id: string }>("events", {
      columns: "id",
      where: "club_id = ? AND slug = ?",
      params: [clubId, candidate],
    });
    if (!taken) return candidate;
  }
  return `${base}-${newId("event").slice(-6).toLowerCase()}`;
}

export async function updateEvent(
  db: TenantDb,
  eventId: string,
  values: Record<string, unknown>,
  now: string,
): Promise<void> {
  await db.update("events", eventId, { ...values, updated_at: now });
}

export async function addTicketType(
  db: TenantDb,
  input: {
    eventId: string;
    name: string;
    priceCents: number;
    capacity?: number | null;
    seatsEach?: number;
    maxPerOrder?: number;
    membersOnly?: boolean;
    description?: string | null;
  },
  now: string,
): Promise<string> {
  const id = newId("ticketType");
  const last = await db.first<{ sort_order: number }>("event_ticket_types", {
    columns: "sort_order",
    where: "event_id = ?",
    params: [input.eventId],
    orderBy: "sort_order DESC",
  });

  await db.insert("event_ticket_types", {
    id,
    event_id: input.eventId,
    name: input.name.trim().slice(0, 80) || "Ticket",
    description: input.description ?? null,
    // Never negative, and always whole cents. A price typed as "35.5.0" ends
    // up here as something, and it must not be something that pays the club.
    price_cents: Math.max(0, Math.round(input.priceCents)),
    capacity: input.capacity ?? null,
    seats_each: Math.max(1, Math.round(input.seatsEach ?? 1)),
    max_per_order: Math.min(50, Math.max(1, Math.round(input.maxPerOrder ?? 10))),
    members_only: input.membersOnly ? 1 : 0,
    sort_order: (last?.sort_order ?? 0) + 1,
    active: 1,
    created_at: now,
    updated_at: now,
  });
  return id;
}

// ── Registering ───────────────────────────────────────────────────────────────

export interface RegisterInput {
  event: EventRow;
  lines: OrderLine[];
  name: string;
  email: string;
  phone?: string | null;
  guests?: number;
  guestNames?: string | null;
  answers?: Record<string, unknown>;
  personId?: string | null;
  isMember: boolean;
  coverCardFee?: boolean;
  ipHash?: string | null;
}

export type RegisterResult =
  | {
      ok: true;
      registration: RegistrationRow;
      waitlisted: boolean;
      /** What the card must be charged. Zero means nothing to pay. */
      chargedCents: number;
      platformFeeCents: number;
    }
  | { ok: false; reason: string; missingAnswers?: string[] };

/**
 * Take a registration.
 *
 * Writes `pending` and then verifies, per the note at the top of the file.
 * A free ticket is confirmed immediately; a paid one stays pending until the
 * webhook says the money arrived, which is the same rule dues and donations
 * already follow — a seat is not sold until it is paid for.
 */
export async function register(
  db: TenantDb,
  input: RegisterInput,
  now: string,
  today: string,
): Promise<RegisterResult> {
  const [typeRows, questionRows, existing] = await Promise.all([
    listTicketTypes(db, input.event.id),
    listQuestions(db, input.event.id),
    listRegistrations(db, input.event.id),
  ]);

  const types = toTicketTypes(typeRows);
  const questions = toQuestions(questionRows);

  const { answers, missing } = validateAnswers(questions, input.answers ?? {});
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "A couple of answers are still needed before we can book you in.",
      missingAnswers: missing,
    };
  }

  const verdict = checkOrder(input.lines, {
    event: {
      status: input.event.status,
      capacity: input.event.capacity,
      allowGuests: input.event.allow_guests === 1,
      maxGuests: input.event.max_guests,
      registrationOpensOn: input.event.registration_opens_on,
      registrationClosesOn: input.event.registration_closes_on,
      waitlist: input.event.waitlist === 1,
    },
    types,
    holders: toHolders(existing),
    soldByType: await soldByType(db, input.event.id),
    isMember: input.isMember,
    today,
    now,
  });

  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const total = priceOrder(input.lines, types, { coverCardFee: input.coverCardFee });
  const free = total.chargedCents === 0;

  const id = newId("registration");
  const status: RegistrationStatus = verdict.waitlisted ? "waitlist" : free ? "confirmed" : "pending";

  await db.insert("event_registrations", {
    id,
    club_id: input.event.club_id,
    event_id: input.event.id,
    person_id: input.personId ?? null,
    name: input.name.trim().slice(0, 200),
    email: input.email.trim().slice(0, 254),
    phone: input.phone?.slice(0, 40) ?? null,
    status,
    seats: verdict.seats,
    guests: Math.max(0, Math.min(input.event.max_guests, input.guests ?? 0)),
    guest_names: input.guestNames?.slice(0, 500) ?? null,
    answers_json: Object.keys(answers).length ? JSON.stringify(answers) : null,
    amount_cents: total.subtotalCents,
    covered_fee_cents: input.coverCardFee ? total.chargedCents - total.subtotalCents : 0,
    platform_fee_cents: total.platformFeeCents,
    charged_cents: total.chargedCents,
    ticket_code: await uniqueTicketCode(db, input.event.id),
    waitlist_position: verdict.waitlisted ? existing.filter((r) => r.status === "waitlist").length + 1 : null,
    registered_at: now,
    confirmed_at: status === "confirmed" ? now : null,
    ip_hash: input.ipHash ?? null,
    created_at: now,
    updated_at: now,
  });

  for (const line of total.lines) {
    const type = typeRows.find((t) => t.id === line.ticketTypeId)!;
    await db.insert("event_registration_items", {
      id: newId("registrationItem"),
      registration_id: id,
      ticket_type_id: line.ticketTypeId,
      quantity: line.quantity,
      unit_price_cents: line.unitCents,
      seats_each: Math.max(1, type.seats_each),
      created_at: now,
    });
  }

  // Verify after writing. If two orders raced, the later `registered_at`
  // loses and moves to the waitlist — a stable outcome that doesn't depend on
  // which request got re-counted first.
  if (!verdict.waitlisted && input.event.capacity !== null) {
    const after = await listRegistrations(db, input.event.id);
    const sold = seatsSold(toHolders(after), now);
    if (sold > input.event.capacity) {
      const mine = after.find((r) => r.id === id);
      const later = after
        .filter((r) => r.status === "pending" || r.status === "confirmed")
        .sort((a, b) => a.registered_at.localeCompare(b.registered_at));
      const iLost = mine && later[later.length - 1]?.id === id;
      if (iLost) {
        if (input.event.waitlist === 1) {
          await db.update("event_registrations", id, {
            status: "waitlist",
            waitlist_position: after.filter((r) => r.status === "waitlist").length + 1,
            updated_at: now,
          });
          const row = (await db.byId<RegistrationRow>("event_registrations", id))!;
          return { ok: true, registration: row, waitlisted: true, chargedCents: 0, platformFeeCents: 0 };
        }
        await db.update("event_registrations", id, { status: "cancelled", cancelled_at: now, updated_at: now });
        return {
          ok: false,
          reason: "Somebody took the last place a moment before you did. Nothing has been charged.",
        };
      }
    }
  }

  const registration = (await db.byId<RegistrationRow>("event_registrations", id))!;

  if (status === "confirmed") {
    await recordEngagement(db, input.event, registration, "registered", now);
  }

  return {
    ok: true,
    registration,
    waitlisted: verdict.waitlisted,
    // A waitlisted booking is never charged. Somebody who may not get in has
    // not bought anything, and holding their money until a seat frees up is
    // the sort of thing that ends up in a complaint rather than a sale.
    chargedCents: verdict.waitlisted ? 0 : total.chargedCents,
    platformFeeCents: verdict.waitlisted ? 0 : total.platformFeeCents,
  };
}

async function uniqueTicketCode(db: TenantDb, eventId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = newTicketCode();
    const taken = await db.first<{ id: string }>("event_registrations", {
      columns: "id",
      where: "event_id = ? AND ticket_code = ?",
      params: [eventId, code],
    });
    if (!taken) return code;
  }
  // 32^6 is a billion; twenty collisions means something is very wrong, and a
  // longer code is better than a failed booking.
  return `${newTicketCode()}${newTicketCode().slice(0, 2)}`;
}

/** Called by the payments webhook when a ticket is paid for. */
export async function confirmPaid(
  db: TenantDb,
  registrationId: string,
  now: string,
): Promise<void> {
  const registration = await db.byId<RegistrationRow>("event_registrations", registrationId);
  if (!registration || registration.status !== "pending") return;

  await db.update("event_registrations", registrationId, {
    status: "confirmed",
    confirmed_at: now,
    updated_at: now,
  });

  const event = await eventById(db, registration.event_id);
  if (event) {
    await recordEngagement(db, event, { ...registration, status: "confirmed" }, "registered", now);
  }
}

/**
 * Give a seat back, and offer it to whoever is next.
 *
 * Promotion happens here rather than on a schedule because the moment a seat
 * frees up is the moment the person waiting for it wants to know.
 */
export async function cancelRegistration(
  db: TenantDb,
  registrationId: string,
  now: string,
): Promise<{ promoted: string[] }> {
  const registration = await db.byId<RegistrationRow>("event_registrations", registrationId);
  if (!registration || registration.status === "cancelled") return { promoted: [] };

  await db.update("event_registrations", registrationId, {
    status: "cancelled",
    cancelled_at: now,
    updated_at: now,
  });

  const event = await eventById(db, registration.event_id);
  if (!event || event.capacity === null) return { promoted: [] };

  const after = await listRegistrations(db, registration.event_id);
  const freed = Math.max(0, event.capacity - seatsSold(toHolders(after), now));
  if (freed === 0) return { promoted: [] };

  const queue = after
    .filter((r) => r.status === "waitlist")
    .map((r) => ({ id: r.id, seats: r.seats, registeredAt: r.registered_at }));

  const promoted = promoteFromWaitlist(queue, freed);
  for (const id of promoted) {
    // Promoted to `pending` when there is money owed, so the seat is held
    // while they pay rather than given away free. A free event promotes
    // straight to confirmed.
    const row = after.find((r) => r.id === id)!;
    await db.update("event_registrations", id, {
      status: row.charged_cents > 0 ? "pending" : "confirmed",
      confirmed_at: row.charged_cents > 0 ? null : now,
      waitlist_position: null,
      registered_at: now,
      updated_at: now,
    });
  }

  return { promoted };
}

// ── The door ──────────────────────────────────────────────────────────────────

export async function findByTicketCode(
  db: TenantDb,
  eventId: string,
  code: string,
): Promise<RegistrationRow | null> {
  const clean = normaliseTicketCode(code);
  if (!clean) return null;
  return db.first<RegistrationRow>("event_registrations", {
    where: "event_id = ? AND ticket_code = ?",
    params: [eventId, clean],
  });
}

export async function checkIn(
  db: TenantDb,
  registrationId: string,
  now: string,
  userId: string | null,
): Promise<{ ok: boolean; alreadyIn?: boolean }> {
  const registration = await db.byId<RegistrationRow>("event_registrations", registrationId);
  if (!registration) return { ok: false };
  if (registration.checked_in_at) return { ok: true, alreadyIn: true };

  await db.update("event_registrations", registrationId, {
    status: "attended",
    checked_in_at: now,
    checked_in_by: userId,
    updated_at: now,
  });

  const event = await eventById(db, registration.event_id);
  if (event) await recordEngagement(db, event, registration, "attended", now);

  return { ok: true };
}

/**
 * Close the door list.
 *
 * Everybody confirmed and not checked in becomes a no-show, which is the
 * single most useful thing an events module can hand a retention engine and
 * the one no other club system records at all. Somebody who books a table and
 * doesn't come is not the same as somebody who never booked.
 */
export async function closeAttendance(
  db: TenantDb,
  eventId: string,
  now: string,
): Promise<{ attended: number; noShows: number }> {
  const registrations = await listRegistrations(db, eventId);
  const event = await eventById(db, eventId);

  let noShows = 0;
  for (const r of registrations) {
    if (r.status !== "confirmed") continue;
    await db.update("event_registrations", r.id, { status: "no_show", updated_at: now });
    noShows++;
    if (event) await recordEngagement(db, event, r, "no_show", now);
  }

  return {
    attended: registrations.filter((r) => r.status === "attended").length,
    noShows,
  };
}

// ── The part that makes this not an island ────────────────────────────────────

/**
 * Write an event registration into the club's memory.
 *
 * This is the whole argument for building events here rather than telling
 * clubs to use Eventbrite. Three lines of consequence:
 *
 *   A registration is an **interaction** — so it shows on the person's page,
 *   in among the meetings they came to and the notes somebody left.
 *
 *   An attendance is **involvement** — so the member who never makes a
 *   Tuesday but runs the auction every year stops reading as disengaged,
 *   which is a false positive that costs a club real trust in the score.
 *
 *   A no-show is a **signal input** — somebody who booked and didn't come is
 *   a different thing from somebody who didn't book, and it is often the
 *   first visible sign of what the drift score exists to catch.
 *
 * Failure here must never fail the registration. Somebody has paid; the seat
 * matters more than the note about the seat.
 */
async function recordEngagement(
  db: TenantDb,
  event: EventRow,
  registration: RegistrationRow,
  kind: "registered" | "attended" | "no_show",
  now: string,
): Promise<void> {
  if (!registration.person_id) return;

  const subject =
    kind === "registered"
      ? `Registered for ${event.title}`
      : kind === "attended"
        ? `Came to ${event.title}`
        : `Booked for ${event.title} but didn't come`;

  // Three kinds rather than one, because the scorer and the timeline both need
  // to tell them apart. 'meeting' is deliberately not used: a club night and a
  // weekly meeting are different kinds of showing up.
  const interactionKind: InteractionKind =
    kind === "registered" ? "rsvp" : kind === "attended" ? "event_attended" : "event_no_show";

  try {
    await logInteraction(
      db,
      {
        clubId: event.club_id,
        personId: registration.person_id,
        kind: interactionKind,
        subject,
        body: registration.seats > 1 ? `${registration.seats} places` : null,
        refType: "event",
        refId: event.id,
        sourceModule: "events",
      },
      now,
    );
  } catch (err) {
    console.error("[events] could not record engagement", err);
  }
}
