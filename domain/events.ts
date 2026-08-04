/**
 * events.ts — seats, waiting lists, and what an order costs.
 *
 * Pure functions over integer cents and integer seats. No database, no Stripe,
 * no clock beyond what is passed in — because every one of these is a thing a
 * volunteer treasurer will check by hand against a bank statement, and the way
 * to survive that is to be provably right rather than probably right.
 *
 * The three things that go wrong in every ticketing system ever built:
 *
 *   **Overselling.** A table of eight is one ticket and eight seats. Count
 *   tickets instead of seats and a hall with room for eighty takes bookings
 *   for two hundred and forty. `seatsFor` and `seatsSold` never count tickets.
 *
 *   **Double-held seats.** Somebody starts a checkout, wanders off, and their
 *   seat is gone forever. Pending registrations hold a seat for a few minutes
 *   and then stop counting — `heldSeats` takes the clock so that rule is
 *   testable rather than a cron job nobody watches.
 *
 *   **A waiting list that isn't a queue.** Promote by registration time, not
 *   by whoever happens to be at the top of a SELECT, and never promote
 *   somebody into fewer seats than they asked for.
 */

import { feeOn, grossUp, type FeeSchedule, STRIPE_US_CARD } from "./fees";
import { EVENT_FEE } from "./pricing";

// ── Shapes ────────────────────────────────────────────────────────────────────

export interface TicketType {
  id: string;
  name: string;
  priceCents: number;
  /** Seats this type may sell on its own. Null shares the event capacity. */
  capacity: number | null;
  /** How many seats one ticket consumes. A table of eight is 8. */
  seatsEach: number;
  maxPerOrder: number;
  membersOnly: boolean;
  active: boolean;
}

export interface OrderLine {
  ticketTypeId: string;
  quantity: number;
}

export type RegistrationStatus =
  | "pending"
  | "confirmed"
  | "waitlist"
  | "cancelled"
  | "attended"
  | "no_show";

export interface SeatHolder {
  status: RegistrationStatus;
  seats: number;
  /** ISO instant. Used for both the pending hold and the waitlist queue. */
  registeredAt: string;
}

/**
 * How long a started-but-unpaid checkout keeps its seat.
 *
 * Long enough to find a card and type it in with somebody's help; short enough
 * that an abandoned tab doesn't lock a seat out of a sold-out fundraiser for
 * the rest of the week. Stripe's own checkout sessions expire at 24 hours,
 * which is far too long to hold a seat in a room of eighty.
 */
export const HOLD_MINUTES = 20;

/** Statuses that occupy a seat right now. */
export function occupiesSeat(status: RegistrationStatus): boolean {
  return status === "confirmed" || status === "attended" || status === "no_show";
}

/**
 * Seats currently taken, including short-lived holds.
 *
 * `no_show` still counts: the seat was sold and the club was paid for it, and
 * a door list that quietly reopens a seat at 7pm is how two people end up with
 * the same chair.
 */
export function seatsSold(holders: SeatHolder[], now: string): number {
  const cutoff = Date.parse(now) - HOLD_MINUTES * 60_000;
  let seats = 0;
  for (const h of holders) {
    if (occupiesSeat(h.status)) seats += h.seats;
    else if (h.status === "pending" && Date.parse(h.registeredAt) >= cutoff) seats += h.seats;
  }
  return seats;
}

/** Seats an order would consume. */
export function seatsFor(lines: OrderLine[], types: TicketType[]): number {
  const byId = new Map(types.map((t) => [t.id, t]));
  return lines.reduce((total, line) => {
    const type = byId.get(line.ticketTypeId);
    if (!type) return total;
    return total + Math.max(0, line.quantity) * Math.max(1, type.seatsEach);
  }, 0);
}

/**
 * Seats left, or null when the event has no ceiling.
 *
 * Never negative. A capacity that was lowered after tickets sold is a real
 * situation — a club moves to a smaller room — and it should read as "full",
 * not as "minus twelve".
 */
export function seatsRemaining(
  capacity: number | null,
  holders: SeatHolder[],
  now: string,
): number | null {
  if (capacity === null) return null;
  return Math.max(0, capacity - seatsSold(holders, now));
}

// ── What an order costs ───────────────────────────────────────────────────────

export interface OrderTotal {
  /** Sum of the ticket prices. What the club is owed. */
  subtotalCents: number;
  /** Ours. Zero on a free order. See EVENT_FEE. */
  platformFeeCents: number;
  /** Stripe's, when the registrant chose to cover it. */
  cardFeeCents: number;
  /** What the card is actually charged. */
  chargedCents: number;
  /** What lands in the club's bank, after both fees. */
  clubReceivesCents: number;
  lines: { ticketTypeId: string; name: string; quantity: number; unitCents: number; totalCents: number }[];
  seats: number;
}

/**
 * Price an order.
 *
 * The order of operations is the whole thing, so it is written out rather than
 * folded into one expression:
 *
 *   1. Sum the tickets. That is what the club is charging.
 *   2. Our fee comes off that subtotal — a percentage of what the club sells,
 *      capped, and never applied to a free ticket.
 *   3. If the registrant covers the card fee, gross up the *subtotal* so the
 *      club still nets the full ticket price. Our fee is not grossed up: we
 *      take a slice of what the club charged, not of what the payer chose to
 *      add on top, and doing it the other way round would quietly charge more
 *      for the generosity.
 */
export function priceOrder(
  lines: OrderLine[],
  types: TicketType[],
  options: { coverCardFee?: boolean; schedule?: FeeSchedule } = {},
): OrderTotal {
  const byId = new Map(types.map((t) => [t.id, t]));
  const schedule = options.schedule ?? STRIPE_US_CARD;

  const priced = lines
    .map((line) => {
      const type = byId.get(line.ticketTypeId);
      if (!type) return null;
      const quantity = Math.max(0, Math.floor(line.quantity));
      return {
        ticketTypeId: type.id,
        name: type.name,
        quantity,
        unitCents: type.priceCents,
        totalCents: quantity * type.priceCents,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null && l.quantity > 0);

  const subtotalCents = priced.reduce((sum, l) => sum + l.totalCents, 0);
  const platformFeeCents = platformFee(subtotalCents);

  const chargedCents =
    subtotalCents === 0
      ? 0
      : options.coverCardFee
        ? grossUp(subtotalCents, schedule)
        : subtotalCents;

  const cardFeeCents = chargedCents === 0 ? 0 : feeOn(chargedCents, schedule);

  return {
    subtotalCents,
    platformFeeCents,
    cardFeeCents,
    chargedCents,
    // What the club actually banks: the charge, less Stripe, less us.
    clubReceivesCents: Math.max(0, chargedCents - cardFeeCents - platformFeeCents),
    lines: priced,
    seats: seatsFor(lines, types),
  };
}

/**
 * Our cut of a paid order.
 *
 * Free is free — a club running a free members' night pays nothing and is
 * charged nothing, which is most club events. Above that it is a small
 * percentage with a hard cap per order, so a $2,000 table sponsorship does not
 * quietly hand us $60.
 */
export function platformFee(subtotalCents: number, schedule = EVENT_FEE): number {
  if (subtotalCents <= 0) return 0;
  return Math.min(schedule.capCents, Math.round(subtotalCents * schedule.rate));
}

// ── Whether an order is allowed at all ────────────────────────────────────────

export interface OrderContext {
  event: {
    status: string;
    capacity: number | null;
    allowGuests: boolean;
    maxGuests: number;
    registrationOpensOn: string | null;
    registrationClosesOn: string | null;
    waitlist: boolean;
  };
  types: TicketType[];
  holders: SeatHolder[];
  /**
   * Seats already sold, per ticket type id, for the types that cap themselves.
   * Supplied separately from `holders` because a holder knows how many seats
   * it took but not which type they came from — and a type that has sold out
   * has to refuse even when the room has room.
   */
  soldByType?: Record<string, number>;
  /** True when the person ordering is a member of the club. */
  isMember: boolean;
  /** YYYY-MM-DD. */
  today: string;
  now: string;
}

export type OrderVerdict =
  | { ok: true; seats: number; waitlisted: boolean }
  | { ok: false; reason: string };

/**
 * Can this order be taken, and does it get a seat or a place in the queue?
 *
 * Every refusal is a sentence a stranger reads on a public page, so none of
 * them are codes and none of them blame anybody.
 */
export function checkOrder(lines: OrderLine[], ctx: OrderContext): OrderVerdict {
  if (ctx.event.status === "cancelled") {
    return { ok: false, reason: "This event has been cancelled." };
  }
  if (ctx.event.status !== "open") {
    return { ok: false, reason: "Registration isn't open for this event." };
  }
  if (ctx.event.registrationOpensOn && ctx.today < ctx.event.registrationOpensOn) {
    return { ok: false, reason: `Registration opens on ${ctx.event.registrationOpensOn}.` };
  }
  if (ctx.event.registrationClosesOn && ctx.today > ctx.event.registrationClosesOn) {
    return { ok: false, reason: "Registration for this event has closed." };
  }

  const chosen = lines.filter((l) => l.quantity > 0);
  if (chosen.length === 0) return { ok: false, reason: "Choose at least one ticket." };

  const byId = new Map(ctx.types.map((t) => [t.id, t]));
  for (const line of chosen) {
    const type = byId.get(line.ticketTypeId);
    if (!type || !type.active) return { ok: false, reason: "One of those tickets is no longer available." };
    if (type.membersOnly && !ctx.isMember) {
      return { ok: false, reason: `"${type.name}" is for club members. Please pick another ticket.` };
    }
    if (line.quantity > type.maxPerOrder) {
      return {
        ok: false,
        reason: `You can book up to ${type.maxPerOrder} of "${type.name}" at a time. For more than that, please contact the club.`,
      };
    }

    // Per-type capacity, where the type sets one. In seats, like everything
    // else — "twelve tables" is twelve tickets and ninety-six seats.
    if (type.capacity !== null) {
      const already = ctx.soldByType?.[type.id] ?? 0;
      const wanted = line.quantity * Math.max(1, type.seatsEach);
      const leftOfType = Math.max(0, type.capacity - already);
      if (leftOfType === 0) {
        return { ok: false, reason: `"${type.name}" has sold out.` };
      }
      if (wanted > leftOfType) {
        const tickets = Math.floor(leftOfType / Math.max(1, type.seatsEach));
        return {
          ok: false,
          reason:
            tickets > 0
              ? `Only ${tickets} of "${type.name}" ${tickets === 1 ? "is" : "are"} left.`
              : `"${type.name}" has sold out.`,
        };
      }
    }
  }

  const seats = seatsFor(chosen, ctx.types);
  const remaining = seatsRemaining(ctx.event.capacity, ctx.holders, ctx.now);

  if (remaining !== null && seats > remaining) {
    if (!ctx.event.waitlist) {
      return {
        ok: false,
        reason:
          remaining === 0
            ? "This event is full."
            : `Only ${remaining} ${remaining === 1 ? "place is" : "places are"} left, and you asked for ${seats}.`,
      };
    }
    return { ok: true, seats, waitlisted: true };
  }

  return { ok: true, seats, waitlisted: false };
}

// ── The waiting list ──────────────────────────────────────────────────────────

export interface WaitlistEntry {
  id: string;
  seats: number;
  registeredAt: string;
}

/**
 * Who to promote when seats free up.
 *
 * First come first served, and **skipped rather than split**: somebody who
 * asked for four seats is not given two. If the next in line doesn't fit, the
 * one behind them who does gets promoted — which is fair, is what every
 * theatre does, and avoids the alternative of a family arriving to find half
 * of them have chairs.
 *
 * Returns ids in the order they should be promoted.
 */
export function promoteFromWaitlist(queue: WaitlistEntry[], seatsFreed: number): string[] {
  if (seatsFreed <= 0) return [];

  const ordered = [...queue].sort(
    (a, b) => Date.parse(a.registeredAt) - Date.parse(b.registeredAt) || a.id.localeCompare(b.id),
  );

  const promoted: string[] = [];
  let left = seatsFreed;
  for (const entry of ordered) {
    if (left <= 0) break;
    if (entry.seats <= left) {
      promoted.push(entry.id);
      left -= entry.seats;
    }
  }
  return promoted;
}

// ── Ticket codes ──────────────────────────────────────────────────────────────

/**
 * The code on a confirmation, and in the QR at the door.
 *
 * Not a secret and not treated as one: it identifies a booking so somebody on
 * the door can find it, and finding a booking is not an authorisation. It is
 * six characters from an alphabet with no I, O, 1 or 0 in it, because the real
 * requirement is that it can be read aloud across a noisy room by somebody
 * whose reading glasses are in the car.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const TICKET_CODE_LENGTH = 6;

export function newTicketCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < TICKET_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Normalise what somebody typed or scanned. Tolerant on purpose.
 *
 * The alphabet leaves out `I`, `O`, `0` and `1` — but it keeps `L`, and `L`
 * is exactly what somebody reads as a `1` or an `I` off a phone screen at a
 * door in bad light. So those two map to `L`, which is the only character
 * they could have been.
 *
 * `0` and `O` get no such treatment and are simply dropped, because there is
 * no character in the alphabet they could plausibly be: guessing `Q` or `D`
 * would turn a typo into a *different valid code*, which is worse than not
 * finding one. A code that doesn't match gets a plain "we can't find that" and
 * the person on the door reads it out again.
 *
 * (An earlier version of this mapped `L` to `1` and back to `I` — which
 * corrupted the one valid character it was supposed to be helping with. The
 * test that let it through asserted an identity, which is no assertion at all.)
 */
export function normaliseTicketCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[1I]/g, "L")
    .replace(/[^2-9A-HJ-NP-Z]/g, "")
    .slice(0, TICKET_CODE_LENGTH);
}

// ── Questions ─────────────────────────────────────────────────────────────────

export const QUESTION_KINDS = ["text", "choice", "checkbox"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export function isQuestionKind(k: unknown): k is QuestionKind {
  return typeof k === "string" && (QUESTION_KINDS as readonly string[]).includes(k);
}

export interface Question {
  id: string;
  label: string;
  kind: QuestionKind;
  options: string[];
  required: boolean;
}

/**
 * Validate and clamp the answers to a registration form.
 *
 * Same posture as the block registry: never throws, drops what it can't make
 * sense of, and reports what a required answer is missing so the form can say
 * so beside the field rather than at the top of the page.
 */
export function validateAnswers(
  questions: Question[],
  submitted: Record<string, unknown>,
): { answers: Record<string, string>; missing: string[] } {
  const answers: Record<string, string> = {};
  const missing: string[] = [];

  for (const q of questions) {
    const raw = submitted[q.id];
    let value = "";

    if (q.kind === "checkbox") {
      value = raw === true || raw === "on" || raw === "true" || raw === "1" ? "yes" : "";
    } else if (q.kind === "choice") {
      value = typeof raw === "string" && q.options.includes(raw) ? raw : "";
    } else {
      value = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 500) : "";
    }

    if (value) answers[q.id] = value;
    else if (q.required) missing.push(q.id);
  }

  return { answers, missing };
}

// ── Reading an event ──────────────────────────────────────────────────────────

/** Cheap, sortable, and it reads the way a club writes it. */
export function eventSlug(title: string, startsOn: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const year = startsOn.slice(0, 4);
  return base ? `${base}-${year}` : `event-${startsOn}`;
}

/**
 * The Rotary year a date falls in, as clubs write it.
 *
 * The Rotary year runs 1 July to 30 June, which is why every club's records
 * are organised in a way no calendar-year software understands.
 */
export function rotaryYear(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return "";
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
