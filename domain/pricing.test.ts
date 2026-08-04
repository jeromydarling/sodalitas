/**
 * pricing.test.ts
 *
 * Two things are being protected here.
 *
 * The arithmetic: money is integer cents and must survive every path without
 * a rounding artefact turning up on an invoice.
 *
 * The honesty: the savings calculator has to be able to say we're the more
 * expensive option, the comparison has to name where competitors beat us, and
 * every estimate has to be labelled as one. A calculator that can only produce
 * good news is an advert, and clubs can tell.
 */
import { describe, it, expect } from "vitest";
import {
  PLANS, PLAN_ORDER, INCUMBENTS, SIDECAR_TOOLS, SETUP_OPTIONS,
  annualCents, annualSavingCents, priceCents, calculateSavings,
  formatCents, formatMonthly, ANNUAL_MONTHS_CHARGED,
  EVENT_FEE, EVENT_FEE_SUMMARY,
} from "./pricing";
import { platformFee } from "./events";
import { LEGAL } from "@content/legal";
import { FEATURES } from "@content/features";

describe("money is integer cents", () => {
  it("holds every price as a whole number of cents", () => {
    for (const plan of Object.values(PLANS)) {
      expect(Number.isInteger(plan.monthlyCents), plan.key).toBe(true);
      expect(Number.isInteger(annualCents(plan)), plan.key).toBe(true);
    }
    for (const o of SETUP_OPTIONS) expect(Number.isInteger(o.priceCents), o.key).toBe(true);
    for (const i of INCUMBENTS) expect(Number.isInteger(i.typicalMonthlyCents), i.key).toBe(true);
    for (const t of SIDECAR_TOOLS) expect(Number.isInteger(t.typicalMonthlyCents), t.key).toBe(true);
  });

  it("keeps savings arithmetic in integers", () => {
    const r = calculateSavings({
      incumbentKey: "clubrunner",
      sidecarKeys: ["email", "forms"],
      planKey: "club_standard",
      period: "annual",
    });
    expect(Number.isInteger(r.currentMonthlyCents)).toBe(true);
    expect(Number.isInteger(r.ourMonthlyCents)).toBe(true);
    expect(Number.isInteger(r.monthlySavingCents)).toBe(true);
    expect(Number.isInteger(r.annualSavingCents)).toBe(true);
  });
});

describe("plans", () => {
  it("gets more expensive as it gets more capable", () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      expect(PLANS[PLAN_ORDER[i]!]!.monthlyCents).toBeGreaterThan(PLANS[PLAN_ORDER[i - 1]!]!.monthlyCents);
    }
  });

  it("sits inside what Rotary clubs already pay", () => {
    // The market benchmark is roughly $29–$115/mo for a club. Priced to be
    // reachable without looking like it can't be serious.
    expect(PLANS.club_starter.monthlyCents).toBeGreaterThanOrEqual(2_900);
    expect(PLANS.club_standard.monthlyCents).toBeLessThanOrEqual(11_500);
  });

  it("states its limits plainly rather than leaving them to be discovered", () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.limits.length, plan.key).toBeGreaterThan(0);
      expect(plan.includes.length, plan.key).toBeGreaterThan(3);
    }
    expect(PLANS.club_starter.limits.join(" ")).toMatch(/50 members/);
  });

  it("keeps the member cap consistent with what the limits say", () => {
    expect(PLANS.club_starter.memberCap).toBe(50);
    expect(PLANS.club_standard.memberCap).toBeNull();
    expect(PLANS.district.clubCap).toBeNull();
  });

  it("describes features in club language, not product language", () => {
    for (const plan of Object.values(PLANS)) {
      for (const line of plan.includes) {
        expect(line, line).not.toMatch(/_|module|engine|layer|platform/i);
      }
    }
  });
});

describe("annual billing", () => {
  it("charges ten months for twelve", () => {
    expect(ANNUAL_MONTHS_CHARGED).toBe(10);
    for (const plan of Object.values(PLANS)) {
      expect(annualCents(plan)).toBe(plan.monthlyCents * 10);
      expect(annualSavingCents(plan)).toBe(plan.monthlyCents * 2);
    }
  });

  it("prices by period", () => {
    expect(priceCents(PLANS.club_standard, "monthly")).toBe(5_900);
    expect(priceCents(PLANS.club_standard, "annual")).toBe(59_000);
  });

  it("compares annual as its true monthly equivalent, not as a lump sum", () => {
    // Comparing $590/yr against a $75/mo bill would be nonsense. The
    // calculator spreads it across twelve months.
    const r = calculateSavings({
      incumbentKey: null, sidecarKeys: [], planKey: "club_standard", period: "annual",
    });
    expect(r.ourMonthlyCents).toBe(Math.round(59_000 / 12));
    expect(r.ourMonthlyCents).toBeLessThan(PLANS.club_standard.monthlyCents);
  });
});

describe("the savings calculator", () => {
  it("adds up the incumbent and the tools bolted onto it", () => {
    const r = calculateSavings({
      incumbentKey: "clubrunner",
      sidecarKeys: ["email", "payments"],
      planKey: "club_standard",
      period: "monthly",
    });
    expect(r.currentMonthlyCents).toBe(7_500 + 3_500 + 2_900);
    expect(r.monthlySavingCents).toBe(13_900 - 5_900);
    expect(r.annualSavingCents).toBe((13_900 - 5_900) * 12);
    expect(r.breakdown).toHaveLength(3);
  });

  // The test that keeps this honest.
  it("reports a negative saving when we are the more expensive option", () => {
    // A district-tier subscription against a club already covered by DACdb.
    const r = calculateSavings({
      incumbentKey: "dacdb", sidecarKeys: [], planKey: "district", period: "monthly",
    });
    expect(r.monthlySavingCents).toBeLessThan(0);
    expect(r.annualSavingCents).toBeLessThan(0);
  });

  it("prefers the club's real figure over our estimate", () => {
    const r = calculateSavings({
      incumbentKey: "clubrunner",
      actualIncumbentMonthlyCents: 4_200,
      sidecarKeys: [],
      planKey: "club_standard",
      period: "monthly",
    });
    expect(r.currentMonthlyCents).toBe(4_200);
    expect(r.usedActualFigure).toBe(true);
    expect(r.breakdown[0]!.label).toMatch(/your figure/i);
  });

  it("labels every estimate as an estimate, and says so above the number", () => {
    const r = calculateSavings({
      incumbentKey: "clubrunner", sidecarKeys: ["email"], planKey: "club_standard", period: "monthly",
    });
    expect(r.usedActualFigure).toBe(false);
    expect(r.caveat).toMatch(/not a quote/i);
    for (const b of r.breakdown) expect(b.label).toMatch(/estimated/i);
  });

  it("still flags estimated add-ons when the main figure is real", () => {
    const r = calculateSavings({
      incumbentKey: "clubrunner",
      actualIncumbentMonthlyCents: 4_200,
      sidecarKeys: ["email"],
      planKey: "club_standard",
      period: "monthly",
    });
    expect(r.caveat).toMatch(/add-on tool costs are typical figures/i);
  });

  it("drops the caveat when there is nothing estimated to caveat", () => {
    const r = calculateSavings({
      incumbentKey: null, sidecarKeys: [], planKey: "club_starter", period: "monthly",
    });
    expect(r.caveat).toBeNull();
    expect(r.breakdown).toEqual([]);
  });

  it("ignores tool keys it doesn't recognise instead of guessing", () => {
    const r = calculateSavings({
      incumbentKey: null, sidecarKeys: ["not_a_real_tool"], planKey: "club_starter", period: "monthly",
    });
    expect(r.currentMonthlyCents).toBe(0);
  });

  it("handles a club currently paying nothing", () => {
    const r = calculateSavings({
      incumbentKey: null, sidecarKeys: [], planKey: "club_starter", period: "monthly",
    });
    expect(r.currentMonthlyCents).toBe(0);
    expect(r.monthlySavingCents).toBe(-3_900);
  });
});

describe("competitor comparison", () => {
  // A comparison chart where the competitor never wins is not a comparison.
  it("names where every competitor genuinely beats us", () => {
    for (const i of INCUMBENTS) {
      expect(i.betterAt.length, i.name).toBeGreaterThanOrEqual(2);
      for (const line of i.betterAt) expect(line.length, i.name).toBeGreaterThan(30);
    }
  });

  it("never concedes something we actually ship", () => {
    const cr = INCUMBENTS.find((i) => i.key === "clubrunner")!;
    const text = cr.betterAt.join(" ");

    // A concession that has quietly gone stale is worse than no concession.
    // It reads as false modesty, and it is a false statement about our own
    // product on the page whose entire value is that it doesn't make any.
    // This list has now gone stale twice — once for the website builder,
    // once for events and documents — so the rule is the assertion rather
    // than any particular sentence.
    expect(text).not.toMatch(/we don't do (this|that)|we have no|don't have (an?|any) /i);

    // Still named, because the difference is real: ClubRunner's ticketing
    // handles more shapes and its library nests deeper. The concession
    // changed shape rather than disappearing, which is the honest outcome of
    // shipping a first version of something.
    expect(text).toMatch(/event ticketing/i);
    expect(text).toMatch(/document library/i);
    expect(text).not.toMatch(/more complete website builder/i);
  });

  it("concedes that DACdb is often already paid for by the district", () => {
    const d = INCUMBENTS.find((i) => i.key === "dacdb")!;
    expect(d.betterAt.join(" ")).toMatch(/already paid for/i);
  });

  it("gives a range alongside every typical figure", () => {
    for (const i of INCUMBENTS) {
      const [lo, hi] = i.rangeMonthlyCents;
      expect(lo, i.name).toBeLessThan(i.typicalMonthlyCents);
      expect(hi, i.name).toBeGreaterThan(i.typicalMonthlyCents);
    }
  });
});

describe("setup options", () => {
  it("leads with the free one", () => {
    expect(SETUP_OPTIONS[0]!.priceCents).toBe(0);
  });

  it("tells clubs when they don't need to buy the paid ones", () => {
    for (const o of SETUP_OPTIONS) {
      expect(o.skipIf.length, o.key).toBeGreaterThan(20);
    }
    expect(SETUP_OPTIONS[0]!.skipIf).toMatch(/right choice for most clubs/i);
    expect(SETUP_OPTIONS.find((o) => o.key === "district_migration")!.skipIf).toMatch(/only worth it/i);
  });
});

describe("formatting", () => {
  it("formats whole dollars without trailing zeros", () => {
    expect(formatCents(3_900)).toBe("$39");
    expect(formatCents(19_900)).toBe("$199");
    expect(formatCents(150_000)).toBe("$1,500");
    expect(formatCents(0)).toBe("$0");
  });

  it("shows cents only when there are any", () => {
    expect(formatCents(4_917)).toBe("$49.17");
    expect(formatCents(4_900)).toBe("$49");
    expect(formatCents(4_900, { showCents: true })).toBe("$49.00");
  });

  it("marks a negative amount clearly", () => {
    expect(formatCents(-2_500)).toBe("−$25");
  });

  it("formats a monthly price", () => {
    expect(formatMonthly(5_900)).toBe("$59/mo");
  });

  it("round-trips every plan price without a rounding artefact", () => {
    for (const plan of Object.values(PLANS)) {
      expect(formatCents(plan.monthlyCents)).not.toContain(".");
      expect(formatCents(annualCents(plan))).not.toContain(".");
    }
  });
});

// ── The one cut we take ───────────────────────────────────────────────────────
//
// This product's whole pitch is that it doesn't take a slice of a club's money.
// Event tickets are the single exception, and the difference between an honest
// exception and a nasty surprise is entirely whether it is said out loud in the
// places somebody would look. These tests are what "said out loud" means.

describe("the event fee is disclosed, everywhere it matters", () => {
  it("says the rate, the cap and the free case in one sentence", () => {
    expect(EVENT_FEE_SUMMARY).toMatch(/1%/);
    expect(EVENT_FEE_SUMMARY).toMatch(/\$1\.50/);
    expect(EVENT_FEE_SUMMARY).toMatch(/free/i);
  });

  it("describes what the code actually charges", () => {
    // The summary is copy; `platformFee` is the money. Nothing stops these
    // drifting apart except this test.
    expect(platformFee(10_000)).toBe(Math.round(10_000 * EVENT_FEE.rate));
    expect(platformFee(1_000_000)).toBe(EVENT_FEE.capCents);
    expect(EVENT_FEE.rate).toBe(0.01);
    expect(EVENT_FEE.capCents).toBe(150);
    expect(platformFee(0)).toBe(0);
  });

  it("names the exception in the terms, next to the claim it qualifies", () => {
    const payment = LEGAL.find((d) => d.slug === "terms")
      ?.sections.find((s) => /payment/i.test(s.heading));
    expect(payment, "terms should have a payment section").toBeTruthy();
    const text = payment!.paragraphs.join(" ");

    // Both halves, in the same section. The claim without the exception is
    // the version that gets a club angry six months in.
    expect(text).toMatch(/no percentage of dues or donations/i);
    expect(text).toMatch(/1%/);
    expect(text).toMatch(/\$1\.50/);
  });

  it("names it on the events feature page rather than only in the terms", () => {
    const events = FEATURES.find((f) => f.slug === "events");
    expect(events, "there should be an events feature page").toBeTruthy();
    expect(events!.body.join(" ")).toMatch(/1%/);
    expect(events!.body.join(" ")).toMatch(/\$1\.50/);
  });
});
