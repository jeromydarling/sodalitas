/**
 * pricing.ts — the single source of truth for every price in the product.
 *
 * Marketing pages, the checkout, the billing gate, the comparison chart and
 * the savings calculator all read from here. Nothing hardcodes a number in
 * JSX, and no surface is allowed to disagree with another — a pricing page
 * that contradicts the invoice is the fastest way to lose a club's trust.
 *
 * **Money is integer cents.** Always. Floats lose half a penny somewhere
 * around the fourth invoice and nobody can ever explain where.
 */

export type PlanKey = "club_starter" | "club_standard" | "district";
export type BillingPeriod = "monthly" | "annual";

export interface Plan {
  key: PlanKey;
  name: string;
  /** Who this is for, in one line, honestly. */
  audience: string;
  monthlyCents: number;
  /** What the club actually gets. No feature-name soup. */
  includes: string[];
  /** Said plainly, so nobody discovers it at renewal. */
  limits: string[];
  /** Member ceiling; null means no limit. */
  memberCap: number | null;
  /** Clubs covered; null means no limit. */
  clubCap: number | null;
}

export const PLANS: Record<PlanKey, Plan> = {
  club_starter: {
    key: "club_starter",
    name: "Club Starter",
    audience: "Smaller clubs who want the roster, the meetings and the follow-ups in one place.",
    monthlyCents: 3_900,
    memberCap: 50,
    clubCap: 1,
    includes: [
      "Member directory and full relationship history",
      "Meetings, attendance and makeups",
      "The membership pipeline, from guest to member",
      "At-risk member signals with the reasons behind them",
      "Tasks and follow-ups",
      "A public club page with a join form",
      "Email to members and segments",
      "CSV import with a dry run before anything changes",
    ],
    limits: [
      "Up to 50 members",
      "One club",
    ],
  },
  club_standard: {
    key: "club_standard",
    name: "Club Standard",
    audience: "Most clubs. Everything above, plus committees, projects and dues.",
    monthlyCents: 5_900,
    memberCap: null,
    clubCap: 1,
    includes: [
      "Everything in Club Starter",
      "Committees with chairs, goals and rosters",
      "Service projects with volunteers, hours and outcomes",
      "Dues invoicing and payment tracking",
      "Online dues and donations through Stripe",
      "Club health scoring with the drivers shown",
      "Reports and exports",
      "Communio — swap what's working with other clubs",
    ],
    limits: [
      "No member limit",
      "One club",
    ],
  },
  district: {
    key: "district",
    name: "District",
    audience: "Districts covering their clubs. One subscription, every club included.",
    monthlyCents: 19_900,
    memberCap: null,
    clubCap: null,
    includes: [
      "Everything in Club Standard, for every club in the district",
      "District dashboard with club health at a glance",
      "Membership pipeline across all clubs",
      "Assistant Governor views for assigned clubs",
      "Shared speaker directory",
      "District-wide projects and committees",
      "Club comparison and trend reporting",
      "Communio governance",
    ],
    limits: [
      "No club limit",
      "No member limit",
    ],
  },
};

export const PLAN_ORDER: PlanKey[] = ["club_starter", "club_standard", "district"];

// ── Annual ────────────────────────────────────────────────────────────────────

/** Two months free on an annual commitment. Stated as such, not as "17% off". */
export const ANNUAL_MONTHS_CHARGED = 10;

export function annualCents(plan: Plan): number {
  return plan.monthlyCents * ANNUAL_MONTHS_CHARGED;
}

export function annualSavingCents(plan: Plan): number {
  return plan.monthlyCents * 12 - annualCents(plan);
}

export function priceCents(plan: Plan, period: BillingPeriod): number {
  return period === "annual" ? annualCents(plan) : plan.monthlyCents;
}

// ── Setup help ────────────────────────────────────────────────────────────────

export interface SetupOption {
  key: string;
  name: string;
  description: string;
  priceCents: number;
  /** Honest about when it's genuinely not needed. */
  skipIf: string;
}

export const SETUP_OPTIONS: SetupOption[] = [
  {
    key: "self_serve",
    name: "Do it yourself",
    description:
      "Export a CSV from your current system and import it. The importer shows you exactly what it will do before it does anything, and you can roll it back.",
    priceCents: 0,
    skipIf: "This is the right choice for most clubs. Genuinely.",
  },
  {
    key: "assisted",
    name: "Assisted migration",
    description:
      "We take your export, clean it up, map the fields, and hand you back a club that's ready to use. One working session to walk through it.",
    priceCents: 25_000,
    skipIf: "Skip this if your data is already tidy — the importer handles clean exports fine.",
  },
  {
    key: "district_migration",
    name: "District migration",
    description:
      "Every club in the district migrated together, with a session for each club's secretary. For districts moving off ClubRunner or DACdb as a group.",
    priceCents: 150_000,
    skipIf: "Only worth it above about eight clubs. Below that, the per-club option costs less.",
  },
];

// ── What clubs pay today ──────────────────────────────────────────────────────

/**
 * Published or widely-reported pricing for the incumbents, used by the savings
 * comparison.
 *
 * These are estimates and labelled as such wherever they're shown. Incumbent
 * pricing is often quote-based and varies by club size and district agreement,
 * so a club's real number may differ — and the calculator says so rather than
 * implying we know their invoice.
 */
export interface Incumbent {
  key: string;
  name: string;
  /** Typical monthly cost for a mid-sized club, in cents. */
  typicalMonthlyCents: number;
  /** The range we've seen, so the single number isn't mistaken for a quote. */
  rangeMonthlyCents: [number, number];
  note: string;
  /** Where they are genuinely better than us. Named, not buried. */
  betterAt: string[];
}

export const INCUMBENTS: Incumbent[] = [
  {
    key: "clubrunner",
    name: "ClubRunner",
    typicalMonthlyCents: 7_500,
    rangeMonthlyCents: [4_000, 12_000],
    note: "Billed annually and tiered by member count. Website hosting is bundled.",
    betterAt: [
      // Kept honest as our own website builder landed. The blanket concession
      // that used to sit here stopped being true; what remains is the part
      // that still is, and it is a real difference rather than a token one.
      "Free-form website layout and file hosting. Ours is built from fixed section types, which is why a club can't make a page that looks wrong — but a club with someone who wants pixel control will find ours restrictive.",
      "Event registration and ticketing, with paid signups and a guest list. We don't do this yet at all.",
      "A document library — bylaws, minutes, budgets, filed and searchable in one place.",
      "Longer track record with Rotary International data integration.",
      "Used by roughly 4,000 clubs, so most Rotarians have seen it before.",
    ],
  },
  {
    key: "dacdb",
    name: "DACdb",
    typicalMonthlyCents: 5_000,
    rangeMonthlyCents: [2_500, 9_000],
    note: "Usually purchased at district level and passed down to clubs.",
    betterAt: [
      "Deep district-level administrative features built up over many years.",
      "Direct Rotary International data synchronisation.",
      "Often already paid for by the district, which makes it free to the club.",
    ],
  },
];

/** Add-on tools clubs commonly buy because their club software doesn't cover it. */
export interface SidecarTool {
  key: string;
  name: string;
  purpose: string;
  typicalMonthlyCents: number;
  replacedBy: PlanKey | null;
}

export const SIDECAR_TOOLS: SidecarTool[] = [
  { key: "email", name: "Email marketing tool", purpose: "Sending to members and segments", typicalMonthlyCents: 3_500, replacedBy: "club_starter" },
  { key: "forms", name: "Form builder", purpose: "Join forms and event signups", typicalMonthlyCents: 2_500, replacedBy: "club_starter" },
  { key: "payments", name: "Dues collection tool", purpose: "Invoicing and online payment", typicalMonthlyCents: 2_900, replacedBy: "club_standard" },
  { key: "signups", name: "Volunteer signup tool", purpose: "Project shifts and hours", typicalMonthlyCents: 1_500, replacedBy: "club_standard" },
];

// ── The savings comparison ────────────────────────────────────────────────────

export interface SavingsInput {
  incumbentKey: string | null;
  /** What the club actually pays, in cents. Overrides the estimate when given. */
  actualIncumbentMonthlyCents?: number | null;
  /** Keys from SIDECAR_TOOLS the club also pays for. */
  sidecarKeys: string[];
  planKey: PlanKey;
  period: BillingPeriod;
}

export interface SavingsResult {
  currentMonthlyCents: number;
  ourMonthlyCents: number;
  /** Positive when we're cheaper, negative when we're not. Both are reported. */
  monthlySavingCents: number;
  annualSavingCents: number;
  breakdown: { label: string; monthlyCents: number }[];
  /** True when the club's figure was supplied rather than estimated. */
  usedActualFigure: boolean;
  /** Shown whenever the comparison rests on our estimates. */
  caveat: string | null;
}

/**
 * Compare what a club pays now against what it would pay us.
 *
 * Reports honestly in both directions. If we come out more expensive, the
 * result says so — a calculator that can only ever produce good news is an
 * advert, and clubs can tell the difference.
 */
export function calculateSavings(input: SavingsInput): SavingsResult {
  const breakdown: { label: string; monthlyCents: number }[] = [];
  let currentMonthlyCents = 0;

  const incumbent = INCUMBENTS.find((i) => i.key === input.incumbentKey) ?? null;
  const usedActualFigure =
    input.actualIncumbentMonthlyCents !== null && input.actualIncumbentMonthlyCents !== undefined;

  if (usedActualFigure) {
    currentMonthlyCents += input.actualIncumbentMonthlyCents!;
    breakdown.push({
      label: incumbent ? `${incumbent.name} (your figure)` : "Your current club software",
      monthlyCents: input.actualIncumbentMonthlyCents!,
    });
  } else if (incumbent) {
    currentMonthlyCents += incumbent.typicalMonthlyCents;
    breakdown.push({ label: `${incumbent.name} (estimated)`, monthlyCents: incumbent.typicalMonthlyCents });
  }

  for (const key of input.sidecarKeys) {
    const tool = SIDECAR_TOOLS.find((t) => t.key === key);
    if (!tool) continue;
    currentMonthlyCents += tool.typicalMonthlyCents;
    breakdown.push({ label: `${tool.name} (estimated)`, monthlyCents: tool.typicalMonthlyCents });
  }

  const plan = PLANS[input.planKey];
  // Annual is compared as its true monthly equivalent — ten months of cost
  // spread across twelve — rather than as a lump sum against a monthly bill.
  const ourMonthlyCents =
    input.period === "annual" ? Math.round(annualCents(plan) / 12) : plan.monthlyCents;

  const monthlySavingCents = currentMonthlyCents - ourMonthlyCents;

  return {
    currentMonthlyCents,
    ourMonthlyCents,
    monthlySavingCents,
    annualSavingCents: monthlySavingCents * 12,
    breakdown,
    usedActualFigure,
    caveat:
      breakdown.length > 0 && !usedActualFigure
        ? "These are typical figures, not a quote. Incumbent pricing varies by club size and district agreement — put in what you actually pay for a real comparison."
        : breakdown.some((b) => b.label.includes("estimated"))
          ? "Add-on tool costs are typical figures, not quotes."
          : null,
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** Cents to a display string. The only place cents become a string. */
export function formatCents(cents: number, opts: { showCents?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const showCents = opts.showCents ?? remainder !== 0;
  const body = showCents
    ? `${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`
    : dollars.toLocaleString("en-US");
  return `${negative ? "−" : ""}$${body}`;
}

export function formatMonthly(cents: number): string {
  return `${formatCents(cents)}/mo`;
}
