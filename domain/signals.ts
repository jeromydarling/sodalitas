/**
 * signals.ts — turning what we know into what someone should do this week.
 *
 * A score tells a club how it's doing. A signal tells one person one thing to
 * do about it. The gap between those two is where most membership software
 * gives up: it produces a dashboard, the dashboard is admired once, and nobody
 * opens it again.
 *
 * Rules this generator holds to, all of them ported from CROS and all of them
 * load-bearing:
 *
 *   **Deterministic.** No model. Rules over facts, so the same week always
 *   produces the same list and a club can trust that nothing appeared because
 *   a prompt drifted.
 *
 *   **Evidence attached.** Every signal carries the numbers that produced it,
 *   so "why am I seeing this?" always has an answer.
 *
 *   **Deduped by key.** The weekly job is safe to re-run, and a signal that
 *   fired last week doesn't fire again just because the condition persists.
 *
 *   **Capped.** This is the one place the port improves on CROS, which
 *   generated as many signals as conditions matched. Forty signals is a
 *   backlog, and a backlog is something a volunteer closes rather than works.
 *   We rank and take the few that matter, because a list of five gets done.
 *
 *   **Nothing sends itself.** A signal is a suggestion with a draft behind it.
 *   A human presses send.
 */

import type { HealthStatus, RiskLevel } from "./scoring";

export type SignalKind =
  | "at_risk"
  | "guest_follow_up"
  | "reconnect"
  | "celebration"
  | "milestone"
  | "dues_overdue"
  | "leadership_gap"
  | "club_watch"
  | "anniversary";

export type Severity = "info" | "notice" | "urgent";

export interface Signal {
  kind: SignalKind;
  severity: Severity;
  clubId: string;
  personId: string | null;
  title: string;
  summary: string;
  /** What to do. One concrete step, doable this week. */
  suggestedAction: string;
  /** The facts behind it. Rendered in the "why am I seeing this?" drawer. */
  evidence: Record<string, string | number | boolean | null>;
  /** Stable across re-runs within the same week. */
  dedupeKey: string;
  /** Internal ranking weight — never shown. */
  priority: number;
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface MemberFactsForSignal {
  personId: string;
  /** Display name. Used in copy, never in anything shared outside the club. */
  name: string;
  risk: RiskLevel;
  score: number;
  daysSinceAttended: number | null;
  daysSinceTouch: number | null;
  /**
   * Why the engagement score came out where it did, straight from the scorer.
   *
   * Load-bearing. Without it this file has to guess, and its guess is always
   * "they've stopped coming" — which produces "David hasn't been to a meeting
   * in 4 days" for a member who attends every week but is on no committee,
   * has never been spoken to, and is behind on dues. He is genuinely at risk;
   * the reason simply isn't absence.
   */
  reasons: string[];
  /** Whether anyone already has an open task about this person. */
  hasOpenTask: boolean;
  /** Years of membership completing this week, if any. */
  anniversaryYears: number | null;
  onLeave: boolean;
}

export interface GuestFactsForSignal {
  personId: string;
  name: string;
  /** Days since they visited. */
  daysSinceVisit: number;
  visitCount: number;
  hasOpenTask: boolean;
  /** Whether the club has already moved them along the pipeline. */
  stage: string;
  hostName: string | null;
}

export interface DuesFactsForSignal {
  personId: string;
  name: string;
  daysOverdue: number;
  amountCents: number;
  hasOpenTask: boolean;
}

export interface MilestoneFactsForSignal {
  kind: "members_gained" | "project_completed" | "attendance_recovered" | "charter_anniversary";
  detail: string;
  value: number;
}

export interface ClubSignalInput {
  clubId: string;
  clubName: string;
  weekStart: string;
  memberCount: number;
  health: { score: number; status: HealthStatus; reasons: string[] };
  healthLastWeek: { score: number; status: HealthStatus } | null;
  members: MemberFactsForSignal[];
  guests: GuestFactsForSignal[];
  overdueDues: DuesFactsForSignal[];
  milestones: MilestoneFactsForSignal[];
  /** Offices with nobody currently assigned. */
  vacantOffices: string[];
}

/**
 * The weekly cap.
 *
 * Chosen for a volunteer with an hour, not for completeness. Everything below
 * the cut is still visible on the member's own page — it just doesn't claim
 * a place in this week's list.
 */
export const WEEKLY_SIGNAL_CAP = 7;

/** A guest goes cold somewhere around here. Before this it's still warm. */
const GUEST_FOLLOW_UP_DAYS = 3;
const GUEST_COLD_DAYS = 21;
/** A member nobody has spoken to in this long has genuinely slipped through. */
const RECONNECT_TOUCH_DAYS = 120;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

// ── Generation ────────────────────────────────────────────────────────────────

/**
 * Build this week's signals for one club.
 *
 * Pure: no database, no clock, no randomness. Everything it needs is in the
 * input, which is what makes the whole thing testable and what makes a week's
 * output reproducible six months later when someone asks why a member was
 * flagged.
 */
export function generateClubSignals(input: ClubSignalInput): Signal[] {
  const out: Signal[] = [];
  const key = (kind: string, suffix: string) =>
    `${kind}:${input.clubId}:${suffix}:${input.weekStart}`;

  // ── Guests who visited and heard nothing back ──
  // The highest-value signal in the product. A guest who came once and was
  // never contacted is the cheapest member a club will ever fail to recruit.
  for (const g of input.guests) {
    if (g.hasOpenTask) continue;
    if (g.daysSinceVisit < GUEST_FOLLOW_UP_DAYS) continue; // still warm, leave it alone
    if (g.stage !== "guest_attended" && g.stage !== "lead") continue;

    const cold = g.daysSinceVisit > GUEST_COLD_DAYS;
    out.push({
      kind: "guest_follow_up",
      severity: cold ? "notice" : "urgent",
      clubId: input.clubId,
      personId: g.personId,
      title: `${g.name} visited and hasn't heard back`,
      summary:
        g.visitCount > 1
          ? `${g.name} has visited ${g.visitCount} times, most recently ${g.daysSinceVisit} days ago. Nobody has followed up.`
          : `${g.name} visited ${g.daysSinceVisit} days ago and nobody has followed up yet.`,
      suggestedAction: g.hostName
        ? `Ask ${g.hostName}, who hosted them, to call this week.`
        : "A short call this week. Ask what they thought, not whether they're joining.",
      evidence: {
        days_since_visit: g.daysSinceVisit,
        visits: g.visitCount,
        stage: g.stage,
        hosted_by: g.hostName,
      },
      dedupeKey: key("guest_follow_up", g.personId),
      // Recent guests outrank cold ones: the window is closing, not closed.
      priority: cold ? 70 : 100,
    });
  }

  // ── Members drifting away ──
  //
  // Two different things get called "at risk" and they need different words and
  // different advice. Someone who has stopped coming needs a phone call.
  // Someone who comes every week but is on nothing, has never been spoken to,
  // and is quietly behind on dues needs a job to do. Telling the second one
  // "we've missed you" would be both wrong and slightly insulting.
  for (const m of input.members) {
    if (m.onLeave || m.hasOpenTask || m.risk !== "at_risk") continue;
    const days = m.daysSinceAttended;
    const absent = days === null || days >= 45;

    out.push({
      kind: "at_risk",
      severity: "notice",
      clubId: input.clubId,
      personId: m.personId,
      title: absent ? `${m.name} has been away a while` : `${m.name} is here, but not really in`,
      summary: absent
        ? days === null
          ? `${m.name} has no attendance on record, and nobody has been in touch.`
          : `${m.name} hasn't been to a meeting in ${days} days.`
        // Lead with what the scorer actually found rather than inventing a cause.
        : `${m.name} is still turning up. ${m.reasons[0] ?? "Their involvement has thinned out."}`,
      suggestedAction: absent
        ? "A note from someone who knows them, asking how they are. Not a reminder about attendance."
        : "Ask them onto a committee or a project. Being needed is what keeps people, and they're already in the room.",
      evidence: {
        engagement_score: m.score,
        days_since_attended: days,
        days_since_contact: m.daysSinceTouch,
        // The full picture, so the drawer can show what the summary summarised.
        reasons: m.reasons.join("; ") || null,
      },
      dedupeKey: key("at_risk", m.personId),
      // Someone who has vanished is further gone than someone still in the room.
      priority: absent ? 85 : 75,
    });
  }

  // ── Members nobody has spoken to at all ──
  // Distinct from at-risk: these people may be attending perfectly happily and
  // still be invisible to the club's leadership. That's how a club is surprised
  // by a resignation.
  for (const m of input.members) {
    if (m.onLeave || m.hasOpenTask || m.risk === "at_risk") continue;
    if (m.daysSinceTouch === null || m.daysSinceTouch >= RECONNECT_TOUCH_DAYS) {
      out.push({
        kind: "reconnect",
        severity: "info",
        clubId: input.clubId,
        personId: m.personId,
        title: `Nobody has caught up with ${m.name} lately`,
        summary:
          m.daysSinceTouch === null
            ? `There's no record of a conversation with ${m.name}.`
            : `The last conversation logged with ${m.name} was ${m.daysSinceTouch} days ago.`,
        suggestedAction: "Five minutes before or after the next meeting is enough.",
        evidence: {
          days_since_contact: m.daysSinceTouch,
          engagement_score: m.score,
          attending: m.daysSinceAttended !== null && m.daysSinceAttended < 30,
        },
        dedupeKey: key("reconnect", m.personId),
        priority: 40,
      });
    }
  }

  // ── Dues ──
  // Grouped, not one per member. Nine separate signals about money is a
  // treasurer's inbox, not a to-do list.
  const chaseable = input.overdueDues.filter((d) => !d.hasOpenTask && d.daysOverdue >= 30);
  if (chaseable.length > 0) {
    const total = chaseable.reduce((s, d) => s + d.amountCents, 0);
    const longest = Math.max(...chaseable.map((d) => d.daysOverdue));
    out.push({
      kind: "dues_overdue",
      severity: longest > 90 ? "notice" : "info",
      clubId: input.clubId,
      personId: chaseable.length === 1 ? chaseable[0]!.personId : null,
      title:
        chaseable.length === 1
          ? `${chaseable[0]!.name}'s dues are ${chaseable[0]!.daysOverdue} days past due`
          : `${chaseable.length} members are behind on dues`,
      summary:
        chaseable.length === 1
          ? `${chaseable[0]!.name} hasn't paid this period. It's often the first sign someone's drifting.`
          : `${chaseable.length} ${plural(chaseable.length, "member")} ${plural(chaseable.length, "is", "are")} behind, the oldest by ${longest} days.`,
      suggestedAction:
        "Call rather than send another reminder. Unpaid dues are usually about something else.",
      evidence: {
        members_behind: chaseable.length,
        total_outstanding_cents: total,
        longest_overdue_days: longest,
      },
      dedupeKey: key("dues_overdue", "batch"),
      priority: 55,
    });
  }

  // ── Anniversaries ──
  // Small, cheap, and the kind of thing a club is glad to be reminded of.
  for (const m of input.members) {
    if (!m.anniversaryYears || m.anniversaryYears < 1) continue;
    // Every year for the first five, then the round ones. Otherwise this
    // crowds out everything else in a club with eighty members.
    const notable = m.anniversaryYears <= 5 || m.anniversaryYears % 5 === 0;
    if (!notable) continue;
    out.push({
      kind: "anniversary",
      severity: "info",
      clubId: input.clubId,
      personId: m.personId,
      title: `${m.name} marks ${m.anniversaryYears} ${plural(m.anniversaryYears, "year")} this week`,
      summary: `${m.name} joined ${m.anniversaryYears} ${plural(m.anniversaryYears, "year")} ago this week.`,
      suggestedAction: "Worth a mention at the meeting.",
      evidence: { years: m.anniversaryYears },
      dedupeKey: key("anniversary", m.personId),
      priority: m.anniversaryYears >= 25 ? 60 : 30,
    });
  }

  // ── Vacant offices ──
  if (input.vacantOffices.length > 0) {
    out.push({
      kind: "leadership_gap",
      severity: "info",
      clubId: input.clubId,
      personId: null,
      title: `${input.vacantOffices.length} ${plural(input.vacantOffices.length, "office")} unfilled`,
      summary: `Nobody is currently assigned to ${listSentence(input.vacantOffices)}.`,
      suggestedAction: "Assign them even provisionally — an empty office means nobody's watching that work.",
      evidence: { vacant: input.vacantOffices.join(", "), count: input.vacantOffices.length },
      dedupeKey: key("leadership_gap", "roles"),
      priority: 45,
    });
  }

  // ── Club-level watch ──
  // Only when the status actually changed. A club that has been on "watch" for
  // three months does not need telling every Monday.
  if (
    input.health.status !== "healthy" &&
    input.healthLastWeek !== null &&
    input.healthLastWeek.status !== input.health.status
  ) {
    out.push({
      kind: "club_watch",
      severity: input.health.status === "at_risk" ? "notice" : "info",
      clubId: input.clubId,
      personId: null,
      title:
        input.health.status === "at_risk"
          ? `${input.clubName} needs attention`
          : `${input.clubName} is worth keeping an eye on`,
      summary:
        input.health.reasons[0] ??
        `Club health moved from ${input.healthLastWeek.status.replace("_", " ")} to ${input.health.status.replace("_", " ")}.`,
      suggestedAction: "Take ten minutes at the next board meeting to look at what changed.",
      evidence: {
        score: input.health.score,
        previous_score: input.healthLastWeek.score,
        status: input.health.status,
        previous_status: input.healthLastWeek.status,
      },
      dedupeKey: key("club_watch", input.health.status),
      priority: input.health.status === "at_risk" ? 90 : 50,
    });
  }

  // ── Something going right ──
  // Not decoration. A weekly list that is only ever bad news gets avoided, and
  // an avoided list helps nobody.
  for (const ms of input.milestones) {
    out.push({
      kind: ms.kind === "charter_anniversary" ? "milestone" : "celebration",
      severity: "info",
      clubId: input.clubId,
      personId: null,
      title: celebrationTitle(ms),
      summary: ms.detail,
      suggestedAction: "Say it out loud at the next meeting. People stay where progress is visible.",
      evidence: { milestone: ms.kind, value: ms.value },
      dedupeKey: key("celebration", ms.kind),
      priority: 35,
    });
  }

  return rank(out);
}

/**
 * Rank and cap.
 *
 * Ties break on dedupe key so the order is stable across runs — a list that
 * reshuffles itself between two loads of the same page reads as broken.
 */
export function rank(signals: Signal[]): Signal[] {
  const sorted = [...signals].sort(
    (a, b) => b.priority - a.priority || a.dedupeKey.localeCompare(b.dedupeKey),
  );
  return sorted.slice(0, WEEKLY_SIGNAL_CAP);
}

/** Everything generated, ranked but uncapped — for the "show me the rest" view. */
export function rankAll(signals: Signal[]): Signal[] {
  return [...signals].sort(
    (a, b) => b.priority - a.priority || a.dedupeKey.localeCompare(b.dedupeKey),
  );
}

function celebrationTitle(ms: MilestoneFactsForSignal): string {
  switch (ms.kind) {
    case "members_gained":
      return `${ms.value} new ${plural(ms.value, "member")} this quarter`;
    case "project_completed":
      return "A service project wrapped up";
    case "attendance_recovered":
      return "Attendance is climbing again";
    case "charter_anniversary":
      return `${ms.value} ${plural(ms.value, "year")} since the club chartered`;
  }
}

/** "a, b and c" — an Oxford comma is not worth the argument. */
function listSentence(items: string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
