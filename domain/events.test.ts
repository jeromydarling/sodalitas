import { describe, it, expect } from "vitest";
import {
  seatsFor,
  seatsSold,
  seatsRemaining,
  occupiesSeat,
  priceOrder,
  platformFee,
  checkOrder,
  promoteFromWaitlist,
  newTicketCode,
  normaliseTicketCode,
  validateAnswers,
  eventSlug,
  rotaryYear,
  HOLD_MINUTES,
  TICKET_CODE_LENGTH,
  type TicketType,
  type SeatHolder,
  type OrderContext,
} from "./events";
import { EVENT_FEE } from "./pricing";
import { feeOn } from "./fees";

const NOW = "2026-08-04T12:00:00.000Z";
const minutesAgo = (n: number) => new Date(Date.parse(NOW) - n * 60_000).toISOString();

const TYPES: TicketType[] = [
  { id: "tt_member", name: "Member", priceCents: 3_000, capacity: null, seatsEach: 1, maxPerOrder: 4, membersOnly: true, active: true },
  { id: "tt_guest", name: "Guest", priceCents: 3_500, capacity: null, seatsEach: 1, maxPerOrder: 6, membersOnly: false, active: true },
  { id: "tt_table", name: "Table of eight", priceCents: 22_000, capacity: 24, seatsEach: 8, maxPerOrder: 2, membersOnly: false, active: true },
  { id: "tt_free", name: "Members' night", priceCents: 0, capacity: null, seatsEach: 1, maxPerOrder: 2, membersOnly: true, active: true },
];

const baseCtx = (over: Partial<OrderContext> = {}): OrderContext => ({
  event: {
    status: "open",
    capacity: 80,
    allowGuests: true,
    maxGuests: 4,
    registrationOpensOn: null,
    registrationClosesOn: null,
    waitlist: true,
  },
  types: TYPES,
  holders: [],
  isMember: true,
  today: "2026-08-04",
  now: NOW,
  ...over,
});

// ── Seats ─────────────────────────────────────────────────────────────────────

describe("seats, not tickets", () => {
  it("counts a table of eight as eight seats", () => {
    // The bug this exists to prevent: count tickets and a hall for eighty
    // takes bookings for two hundred and forty.
    expect(seatsFor([{ ticketTypeId: "tt_table", quantity: 2 }], TYPES)).toBe(16);
    expect(seatsFor([{ ticketTypeId: "tt_member", quantity: 2 }], TYPES)).toBe(2);
  });

  it("adds mixed lines up", () => {
    expect(
      seatsFor(
        [
          { ticketTypeId: "tt_member", quantity: 1 },
          { ticketTypeId: "tt_guest", quantity: 3 },
          { ticketTypeId: "tt_table", quantity: 1 },
        ],
        TYPES,
      ),
    ).toBe(12);
  });

  it("ignores a ticket type that doesn't exist and negative quantities", () => {
    expect(seatsFor([{ ticketTypeId: "nope", quantity: 5 }], TYPES)).toBe(0);
    expect(seatsFor([{ ticketTypeId: "tt_member", quantity: -3 }], TYPES)).toBe(0);
  });
});

describe("which statuses take up a chair", () => {
  it("counts everyone who was sold a seat, including no-shows", () => {
    // A no-show was paid for. Reopening that seat at 7pm is how two people
    // end up with the same chair.
    expect(occupiesSeat("confirmed")).toBe(true);
    expect(occupiesSeat("attended")).toBe(true);
    expect(occupiesSeat("no_show")).toBe(true);
    expect(occupiesSeat("cancelled")).toBe(false);
    expect(occupiesSeat("waitlist")).toBe(false);
    expect(occupiesSeat("pending")).toBe(false);
  });

  it("holds a seat for a checkout in progress, then lets it go", () => {
    const holders: SeatHolder[] = [
      { status: "pending", seats: 2, registeredAt: minutesAgo(HOLD_MINUTES - 5) },
      { status: "pending", seats: 3, registeredAt: minutesAgo(HOLD_MINUTES + 5) },
    ];
    // The fresh one still holds; the abandoned tab has released its seats.
    expect(seatsSold(holders, NOW)).toBe(2);
  });

  it("never reports a negative number of seats left", () => {
    // A club moves to a smaller room after tickets have sold. That reads as
    // "full", not as "minus twelve".
    const holders: SeatHolder[] = [{ status: "confirmed", seats: 40, registeredAt: NOW }];
    expect(seatsRemaining(20, holders, NOW)).toBe(0);
    expect(seatsRemaining(null, holders, NOW)).toBeNull();
  });
});

// ── Money ─────────────────────────────────────────────────────────────────────

describe("what an order costs", () => {
  it("adds up the tickets", () => {
    const total = priceOrder(
      [
        { ticketTypeId: "tt_member", quantity: 2 },
        { ticketTypeId: "tt_guest", quantity: 1 },
      ],
      TYPES,
    );
    expect(total.subtotalCents).toBe(9_500);
    expect(total.chargedCents).toBe(9_500);
    expect(total.seats).toBe(3);
    expect(total.lines).toHaveLength(2);
  });

  it("charges nothing at all for a free ticket", () => {
    const total = priceOrder([{ ticketTypeId: "tt_free", quantity: 2 }], TYPES);
    expect(total.subtotalCents).toBe(0);
    expect(total.chargedCents).toBe(0);
    expect(total.cardFeeCents).toBe(0);
    expect(total.platformFeeCents).toBe(0);
  });

  it("leaves the club whole when the registrant covers the card fee", () => {
    // The classic bug: charge subtotal + 2.9% + 30c and the club is still
    // short, because Stripe's fee applies to the larger number. grossUp
    // solves the fixed point instead.
    const total = priceOrder([{ ticketTypeId: "tt_guest", quantity: 1 }], TYPES, {
      coverCardFee: true,
    });
    expect(total.chargedCents).toBeGreaterThan(total.subtotalCents);
    expect(total.chargedCents - total.cardFeeCents).toBeGreaterThanOrEqual(total.subtotalCents);
  });

  it("does not take our fee on the money the payer added for Stripe", () => {
    // A registrant covering the card fee is doing the club a kindness. Taking
    // a percentage of that kindness would be charging more for generosity.
    const plain = priceOrder([{ ticketTypeId: "tt_guest", quantity: 1 }], TYPES);
    const covered = priceOrder([{ ticketTypeId: "tt_guest", quantity: 1 }], TYPES, {
      coverCardFee: true,
    });
    expect(covered.platformFeeCents).toBe(plain.platformFeeCents);
  });

  it("reports what the club actually banks", () => {
    const total = priceOrder([{ ticketTypeId: "tt_guest", quantity: 2 }], TYPES);
    expect(total.clubReceivesCents).toBe(
      total.chargedCents - feeOn(total.chargedCents) - total.platformFeeCents,
    );
  });
});

describe("our cut", () => {
  it("is nothing on a free order", () => {
    expect(platformFee(0)).toBe(0);
    expect(platformFee(-500)).toBe(0);
  });

  it("is 1% on an ordinary ticket", () => {
    // A $35 dinner ticket costs the club 35 cents.
    expect(platformFee(3_500)).toBe(35);
    expect(platformFee(9_500)).toBe(95);
  });

  it("stops at the cap, so the big fundraiser isn't our best month", () => {
    // A $2,000 table sponsorship. 1% would be $20; the cap makes it $1.50.
    expect(platformFee(200_000)).toBe(EVENT_FEE.capCents);
    expect(platformFee(1_000_000)).toBe(EVENT_FEE.capCents);
    // The cap bites exactly where the arithmetic says it should.
    expect(platformFee(15_000)).toBe(150);
    expect(platformFee(14_900)).toBe(149);
  });

  it("is small enough to state out loud beside Eventbrite's", () => {
    const ticket = 3_500;
    const ours = platformFee(ticket);
    // Eventbrite: roughly 3.7% + $1.79.
    const theirs = Math.round(ticket * 0.037) + 179;
    expect(ours).toBeLessThan(theirs / 5);
  });
});

// ── Whether the order is allowed ──────────────────────────────────────────────

describe("checkOrder", () => {
  it("takes an ordinary order", () => {
    const verdict = checkOrder([{ ticketTypeId: "tt_member", quantity: 2 }], baseCtx());
    expect(verdict).toEqual({ ok: true, seats: 2, waitlisted: false });
  });

  it("refuses a draft, closed or cancelled event in words a stranger reads", () => {
    for (const status of ["draft", "closed"]) {
      const v = checkOrder([{ ticketTypeId: "tt_member", quantity: 1 }], baseCtx({ event: { ...baseCtx().event, status } }));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toMatch(/isn't open/i);
    }
    const cancelled = checkOrder(
      [{ ticketTypeId: "tt_member", quantity: 1 }],
      baseCtx({ event: { ...baseCtx().event, status: "cancelled" } }),
    );
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.reason).toMatch(/cancelled/i);
  });

  it("respects the registration window", () => {
    const early = checkOrder(
      [{ ticketTypeId: "tt_member", quantity: 1 }],
      baseCtx({ event: { ...baseCtx().event, registrationOpensOn: "2026-09-01" } }),
    );
    expect(early.ok).toBe(false);

    const late = checkOrder(
      [{ ticketTypeId: "tt_member", quantity: 1 }],
      baseCtx({ event: { ...baseCtx().event, registrationClosesOn: "2026-08-01" } }),
    );
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toMatch(/closed/i);
  });

  it("keeps a members-only ticket for members", () => {
    const v = checkOrder([{ ticketTypeId: "tt_member", quantity: 1 }], baseCtx({ isMember: false }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("Member");
  });

  it("caps how many of one type go in a single order", () => {
    const v = checkOrder([{ ticketTypeId: "tt_member", quantity: 9 }], baseCtx());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("contact the club");
  });

  it("counts a per-type capacity in seats", () => {
    // 24 seats of tables = three tables. Two are gone; asking for two more
    // is sixteen seats against eight left.
    const v = checkOrder(
      [{ ticketTypeId: "tt_table", quantity: 2 }],
      baseCtx({ soldByType: { tt_table: 16 } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("Only 1");

    const ok = checkOrder(
      [{ ticketTypeId: "tt_table", quantity: 1 }],
      baseCtx({ soldByType: { tt_table: 16 } }),
    );
    expect(ok.ok).toBe(true);
  });

  it("waitlists rather than refusing when the room is full", () => {
    const holders: SeatHolder[] = [{ status: "confirmed", seats: 79, registeredAt: NOW }];
    const v = checkOrder([{ ticketTypeId: "tt_guest", quantity: 3 }], baseCtx({ holders }));
    expect(v).toEqual({ ok: true, seats: 3, waitlisted: true });
  });

  it("refuses outright when the club turned the waiting list off", () => {
    const holders: SeatHolder[] = [{ status: "confirmed", seats: 80, registeredAt: NOW }];
    const v = checkOrder(
      [{ ticketTypeId: "tt_guest", quantity: 1 }],
      baseCtx({ holders, event: { ...baseCtx().event, waitlist: false } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("This event is full.");
  });

  it("says how many are left when it's a near miss", () => {
    const holders: SeatHolder[] = [{ status: "confirmed", seats: 78, registeredAt: NOW }];
    const v = checkOrder(
      [{ ticketTypeId: "tt_guest", quantity: 5 }],
      baseCtx({ holders, event: { ...baseCtx().event, waitlist: false } }),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("Only 2 places");
  });

  it("asks for at least one ticket", () => {
    expect(checkOrder([], baseCtx()).ok).toBe(false);
    expect(checkOrder([{ ticketTypeId: "tt_member", quantity: 0 }], baseCtx()).ok).toBe(false);
  });
});

// ── The queue ─────────────────────────────────────────────────────────────────

describe("promoteFromWaitlist", () => {
  const queue = [
    { id: "c", seats: 1, registeredAt: "2026-08-03T10:00:00.000Z" },
    { id: "a", seats: 4, registeredAt: "2026-08-01T10:00:00.000Z" },
    { id: "b", seats: 2, registeredAt: "2026-08-02T10:00:00.000Z" },
  ];

  it("goes in the order people joined it", () => {
    expect(promoteFromWaitlist(queue, 10)).toEqual(["a", "b", "c"]);
  });

  it("skips somebody who doesn't fit rather than splitting them", () => {
    // Two seats free. The first in line asked for four; giving them two would
    // mean a family arriving to find half of them have chairs.
    expect(promoteFromWaitlist(queue, 2)).toEqual(["b"]);
  });

  it("keeps filling after a skip", () => {
    expect(promoteFromWaitlist(queue, 3)).toEqual(["b", "c"]);
  });

  it("does nothing when nothing freed up", () => {
    expect(promoteFromWaitlist(queue, 0)).toEqual([]);
    expect(promoteFromWaitlist([], 5)).toEqual([]);
  });

  it("breaks a tie on identical timestamps deterministically", () => {
    const tied = [
      { id: "z", seats: 1, registeredAt: NOW },
      { id: "a", seats: 1, registeredAt: NOW },
    ];
    expect(promoteFromWaitlist(tied, 1)).toEqual(["a"]);
  });
});

// ── Ticket codes ──────────────────────────────────────────────────────────────

describe("ticket codes", () => {
  it("avoids the characters people misread aloud", () => {
    let all = "";
    for (let i = 0; i < 200; i++) all += newTicketCode();
    expect(all).not.toMatch(/[IO01]/);
    expect(newTicketCode()).toHaveLength(TICKET_CODE_LENGTH);
  });

  it("tidies up spacing and punctuation", () => {
    expect(normaliseTicketCode(" a7k-2m9 ")).toBe("A7K2M9");
    expect(normaliseTicketCode("a7k 2m9")).toBe("A7K2M9");
  });

  it("reads a 1 or an I as the L it must have been", () => {
    // L is in the alphabet; 1 and I are not, and they are what somebody reads
    // an L as off a phone screen at a door in bad light.
    expect(normaliseTicketCode("A7K1M9")).toBe("A7KLM9");
    expect(normaliseTicketCode("A7KIM9")).toBe("A7KLM9");
    // And an L stays an L. An earlier version mapped it to 1 and then to I,
    // corrupting the one character it was meant to be helping with.
    expect(normaliseTicketCode("A7KLM9")).toBe("A7KLM9");
  });

  it("drops a character it cannot honestly guess at", () => {
    // Nothing in the alphabet is plausibly an O or a 0. Guessing Q would turn
    // a typo into a different valid code, which is worse than not finding one.
    expect(normaliseTicketCode("A7KOM9")).toBe("A7KM9");
    expect(normaliseTicketCode("A7K0M9")).toBe("A7KM9");
  });

  it("only ever emits characters a code can contain", () => {
    for (let i = 0; i < 50; i++) {
      const code = newTicketCode();
      expect(normaliseTicketCode(code), code).toBe(code);
    }
  });

  it("never returns more characters than a code has", () => {
    expect(normaliseTicketCode("ABCDEFGHJK").length).toBe(TICKET_CODE_LENGTH);
  });
});

// ── Questions ─────────────────────────────────────────────────────────────────

describe("validateAnswers", () => {
  const questions = [
    { id: "q1", label: "Dietary requirements", kind: "text" as const, options: [], required: false },
    { id: "q2", label: "Main course", kind: "choice" as const, options: ["Beef", "Fish", "Vegetarian"], required: true },
    { id: "q3", label: "First Rotary event?", kind: "checkbox" as const, options: [], required: false },
  ];

  it("keeps a good set of answers", () => {
    const { answers, missing } = validateAnswers(questions, {
      q1: "  No  nuts  ",
      q2: "Fish",
      q3: "on",
    });
    expect(answers).toEqual({ q1: "No nuts", q2: "Fish", q3: "yes" });
    expect(missing).toEqual([]);
  });

  it("refuses a choice that wasn't on the menu", () => {
    const { answers, missing } = validateAnswers(questions, { q2: "Lobster thermidor" });
    expect(answers.q2).toBeUndefined();
    expect(missing).toEqual(["q2"]);
  });

  it("names what's missing so the form can say so beside the field", () => {
    expect(validateAnswers(questions, {}).missing).toEqual(["q2"]);
  });

  it("truncates rather than storing an essay", () => {
    const { answers } = validateAnswers(questions, { q1: "x".repeat(2000), q2: "Beef" });
    expect(answers.q1!.length).toBe(500);
  });
});

// ── Small things ──────────────────────────────────────────────────────────────

describe("slugs and Rotary years", () => {
  it("makes a readable, stable slug", () => {
    expect(eventSlug("The Annual Charity Auction!", "2026-11-14")).toBe(
      "the-annual-charity-auction-2026",
    );
    expect(eventSlug("", "2026-11-14")).toBe("event-2026-11-14");
  });

  it("knows the Rotary year runs July to June", () => {
    // The reason no calendar-year software understands a club's filing.
    expect(rotaryYear("2026-08-04")).toBe("2026-27");
    expect(rotaryYear("2026-06-30")).toBe("2025-26");
    expect(rotaryYear("2026-07-01")).toBe("2026-27");
    expect(rotaryYear("nonsense")).toBe("");
  });
});
