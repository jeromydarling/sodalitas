/**
 * fees.ts — card processing fees, and the arithmetic of offering to cover them.
 *
 * Pure functions over integer cents. No Stripe import, no network, no config:
 * this is the sort of thing that must be provably right, and the way to make it
 * provably right is to make it testable without a payment processor.
 *
 * Two directions matter and they are not inverses of each other:
 *
 *   feeOn(amount)      — what Stripe takes from a charge of `amount`.
 *   grossUp(amount)    — what to charge so the club NETS `amount` after the fee.
 *
 * Getting these backwards is the classic bug: charge $100 + 2.9% + 30¢ = $103.20,
 * on which Stripe's fee is $3.29, so the club receives $99.91 and the donor who
 * generously "covered the fee" left the club nine cents short. The gross-up
 * formula below solves for the fixed point instead.
 */

/** Stripe's standard US card rate. Overridable because it isn't universal. */
export interface FeeSchedule {
  /** Proportional part, e.g. 0.029 for 2.9%. */
  rate: number;
  /** Fixed part, in cents. */
  fixedCents: number;
}

export const STRIPE_US_CARD: FeeSchedule = { rate: 0.029, fixedCents: 30 };

/**
 * The fee on a charge of `chargedCents`.
 *
 * Rounded half-up to the cent, matching Stripe's own rounding. A cent of drift
 * here shows up as a permanently-not-quite-reconciling ledger, which is the
 * kind of thing a volunteer treasurer will (rightly) stop trusting the product
 * over.
 */
export function feeOn(chargedCents: number, schedule: FeeSchedule = STRIPE_US_CARD): number {
  if (chargedCents <= 0) return 0;
  return Math.round(chargedCents * schedule.rate) + schedule.fixedCents;
}

/**
 * What to charge so that the club receives exactly `netCents`.
 *
 * Solve  charged − (charged × rate + fixed) = net  for charged:
 *
 *   charged = (net + fixed) / (1 − rate)
 *
 * Rounded up, so the club is never short. The payer may pay one cent more than
 * strictly necessary; nobody has ever complained about that, and the opposite
 * error means the treasurer's numbers don't add up.
 */
export function grossUp(netCents: number, schedule: FeeSchedule = STRIPE_US_CARD): number {
  if (netCents <= 0) return 0;
  return Math.ceil((netCents + schedule.fixedCents) / (1 - schedule.rate));
}

export interface FeeBreakdown {
  /** What the club receives. */
  netCents: number;
  /** What the card is charged. */
  chargedCents: number;
  /** What the processor takes. */
  feeCents: number;
  /** Whether the payer chose to absorb the fee. */
  covered: boolean;
}

/**
 * Work out the three numbers for one payment.
 *
 * When the payer covers the fee we gross up, so the club nets the full amount.
 * When they don't, the amount is charged as-is and the club nets less — and we
 * say so rather than hiding it, because a treasurer who discovers the shortfall
 * at reconciliation time assumes the software is wrong.
 */
export function breakdown(
  amountCents: number,
  covered: boolean,
  schedule: FeeSchedule = STRIPE_US_CARD,
): FeeBreakdown {
  if (amountCents <= 0) {
    return { netCents: 0, chargedCents: 0, feeCents: 0, covered };
  }
  if (covered) {
    const charged = grossUp(amountCents, schedule);
    return {
      netCents: amountCents,
      chargedCents: charged,
      // Derive the fee from the charge rather than assuming, so the three
      // numbers always sum. Rounding up in grossUp can leave the club a cent
      // ahead, which lands here as a fee one cent smaller — correct, and the
      // identity net + fee === charged holds.
      feeCents: charged - amountCents,
      covered,
    };
  }
  const fee = feeOn(amountCents, schedule);
  return {
    netCents: amountCents - fee,
    chargedCents: amountCents,
    feeCents: fee,
    covered,
  };
}

/** "$1,234.56". The only place cents become dollars. */
export function formatCents(cents: number, currency = "usd"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const symbol = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? "";
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const part = String(abs % 100).padStart(2, "0");
  return `${sign}${symbol}${whole}.${part}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: "$",
  cad: "$",
  aud: "$",
  nzd: "$",
  gbp: "£",
  eur: "€",
};

/**
 * Parse what a treasurer typed into a dollar field.
 *
 * Accepts "$1,200", "1200", "1200.00", " 1,200.5 ". Returns null for anything
 * else — including "twelve hundred", which is a real thing people type and a
 * silent 0 would be much worse than a validation message.
 */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
