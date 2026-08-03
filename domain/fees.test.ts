import { describe, it, expect } from "vitest";
import {
  feeOn,
  grossUp,
  breakdown,
  formatCents,
  parseDollars,
  STRIPE_US_CARD,
} from "./fees";

describe("feeOn", () => {
  it("is 2.9% plus 30 cents", () => {
    expect(feeOn(10000)).toBe(320); // $100 → $3.20
    expect(feeOn(2500)).toBe(103); // $25 → $1.03
  });

  it("is zero on nothing", () => {
    expect(feeOn(0)).toBe(0);
    expect(feeOn(-500)).toBe(0);
  });

  it("still charges the fixed part on a tiny amount", () => {
    // A $0.50 donation costs more to process than it raises. That's true, and
    // the honest number is the one that shows it.
    expect(feeOn(50)).toBe(31);
  });
});

describe("grossUp", () => {
  it("leaves the club whole", () => {
    // The whole point: charge this, and after the fee the club still has $100.
    const charged = grossUp(10000);
    expect(charged - feeOn(charged)).toBeGreaterThanOrEqual(10000);
  });

  it("never leaves the club short, across a wide range", () => {
    for (let net = 100; net <= 500_00; net += 137) {
      const charged = grossUp(net);
      expect(charged - feeOn(charged)).toBeGreaterThanOrEqual(net);
    }
  });

  it("is never more than a cent generous", () => {
    // Rounding up may overshoot, but only just — a payer who covers the fee
    // should not be quietly donating an extra dollar.
    for (let net = 100; net <= 500_00; net += 137) {
      const charged = grossUp(net);
      expect(charged - feeOn(charged) - net).toBeLessThanOrEqual(1);
    }
  });

  it("is not the naive amount + fee", () => {
    // The bug this function exists to prevent.
    const naive = 10000 + feeOn(10000);
    expect(grossUp(10000)).toBeGreaterThan(naive);
    expect(naive - feeOn(naive)).toBeLessThan(10000);
  });

  it("is zero on nothing", () => {
    expect(grossUp(0)).toBe(0);
  });
});

describe("breakdown", () => {
  it("balances when the fee is covered", () => {
    const b = breakdown(10000, true);
    expect(b.netCents).toBe(10000);
    expect(b.netCents + b.feeCents).toBe(b.chargedCents);
    expect(b.chargedCents).toBeGreaterThan(10000);
  });

  it("balances when the fee is not covered", () => {
    const b = breakdown(10000, false);
    expect(b.chargedCents).toBe(10000);
    expect(b.netCents + b.feeCents).toBe(b.chargedCents);
    expect(b.netCents).toBeLessThan(10000);
  });

  it("always satisfies net + fee = charged", () => {
    for (const amount of [100, 999, 2500, 5000, 15000, 250_00, 1_000_00]) {
      for (const covered of [true, false]) {
        const b = breakdown(amount, covered);
        expect(b.netCents + b.feeCents).toBe(b.chargedCents);
      }
    }
  });

  it("honours an alternative schedule", () => {
    const eu = { rate: 0.015, fixedCents: 25 };
    const b = breakdown(10000, false, eu);
    expect(b.feeCents).toBe(175);
  });

  it("handles zero without dividing by anything", () => {
    expect(breakdown(0, true)).toEqual({
      netCents: 0,
      chargedCents: 0,
      feeCents: 0,
      covered: true,
    });
  });
});

describe("formatCents", () => {
  it("formats dollars", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(150)).toBe("$1.50");
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("keeps the sign outside the symbol", () => {
    expect(formatCents(-2500)).toBe("-$25.00");
  });

  it("knows a few currencies and shrugs at the rest", () => {
    expect(formatCents(1000, "gbp")).toBe("£10.00");
    expect(formatCents(1000, "eur")).toBe("€10.00");
    expect(formatCents(1000, "chf")).toBe("10.00");
  });
});

describe("parseDollars", () => {
  it("accepts what people actually type", () => {
    expect(parseDollars("150")).toBe(15000);
    expect(parseDollars("150.00")).toBe(15000);
    expect(parseDollars("$150")).toBe(15000);
    expect(parseDollars(" 1,200.50 ")).toBe(120050);
    expect(parseDollars("0.05")).toBe(5);
  });

  it("pads a single decimal place", () => {
    expect(parseDollars("1.5")).toBe(150);
  });

  it("refuses rather than guessing", () => {
    expect(parseDollars("twelve hundred")).toBeNull();
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
    expect(parseDollars("-50")).toBeNull();
    expect(parseDollars("1e3")).toBeNull();
  });
});

describe("the schedule itself", () => {
  it("is Stripe's published US card rate", () => {
    expect(STRIPE_US_CARD).toEqual({ rate: 0.029, fixedCents: 30 });
  });
});
