/**
 * scoring.ts — club health and member engagement.
 *
 * These are the numbers the whole product is judged on, so two decisions are
 * baked in and not negotiable:
 *
 *   **Deterministic.** Same facts in, same score out, forever. No model, no
 *   randomness, no drift between Tuesday and Thursday. AI may later explain a
 *   score in prose; it may never produce one.
 *
 *   **Explainable.** Every score returns the drivers that made it — each with
 *   the points it earned, the points available, and a sentence a human can
 *   read. A membership chair being told "Bill is at risk" will ask why, and
 *   "the algorithm says so" is how a tool loses a club.
 *
 * Both functions are pure: they take facts a caller has already gathered and
 * return a score. No database, no clock. That makes them trivially testable,
 * and the tests below are where the real judgements live.
 */

// ── Shared shapes ─────────────────────────────────────────────────────────────

export interface Driver {
  key: string;
  /** Shown in the "why?" drawer. Plain language, no jargon, no scolding. */
  label: string;
  /** The underlying measurement, for anyone who wants the raw number. */
  value: string;
  points: number;
  max: number;
}

export type HealthStatus = "healthy" | "watch" | "at_risk";
export type RiskLevel = "steady" | "watch" | "at_risk";

export interface ScoreResult<S extends string> {
  score: number;
  status: S;
  drivers: Driver[];
  /** The one or two things actually dragging the score down. */
  reasons: string[];
  /** What to do about it. Concrete, small, and doable this week. */
  actions: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 10) / 10;

/** Linear award: `value` mapped from `floor`→0 points to `target`→`max` points. */
function award(value: number, floor: number, target: number, max: number): number {
  if (target === floor) return value >= target ? max : 0;
  const t = (value - floor) / (target - floor);
  return round(clamp(t, 0, 1) * max);
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The smaller of two "days since" figures, ignoring the ones we don't know. */
function nearest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** "On 1 committee, 2 projects, and at 3 club events" — only the true parts. */
function involvementLabel(committees: number, projects: number, events: number): string {
  const parts: string[] = [];
  if (committees > 0) parts.push(`${committees} committee${committees === 1 ? "" : "s"}`);
  if (projects > 0) parts.push(`${projects} project${projects === 1 ? "" : "s"}`);
  const lead = parts.length ? `On ${joinList(parts)}` : "";
  if (events > 0) {
    const evented = `at ${events} club event${events === 1 ? "" : "s"}`;
    return lead ? `${lead}, and ${evented}` : `At ${events} club event${events === 1 ? "" : "s"}`;
  }
  return lead;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ── Club health ───────────────────────────────────────────────────────────────

export interface ClubFacts {
  /** Active members today. */
  memberCount: number;
  /** Joins minus departures over the last 90 days. */
  netChange90d: number;
  departures90d: number;
  departures365d: number;
  /**
   * Share of active members present at a typical recent meeting, 0–1.
   * Null when the club hasn't recorded attendance — which is a different
   * situation from poor attendance, and scored as such.
   */
  attendanceRate90d: number | null;
  /** Same measure for the 90 days before that, for trend. Null if unknown. */
  attendanceRatePrior90d: number | null;
  /** Memberships in a pre-member stage: lead through candidate. */
  activeProspects: number;
  /** Guests who attended in the last 90 days. */
  guests90d: number;
  /** Members holding at least one committee seat. */
  membersOnCommittees: number;
  /** Members who logged project participation in the last 180 days. */
  membersOnProjects: number;
  /** Service projects active or completed in the last 180 days. */
  activeProjects: number;
  /** Share of dues invoices past due, 0–1. Null when the club doesn't track dues here. */
  duesDelinquentRate: number | null;
  /** Members currently flagged at risk. */
  atRiskMembers: number;
  /** Of those, how many have had a touchpoint logged in the last 30 days. */
  atRiskMembersTouched: number;
  /** Days since the club recorded anything at all. Detects an abandoned account. */
  daysSinceLastActivity: number | null;
}

/**
 * Weights, summing to 100. Attendance and growth carry the most because they
 * are what a club notices first when it starts to slip, and what a district
 * governor is actually asking about.
 */
export const CLUB_WEIGHTS = {
  attendance: 25,
  growth: 20,
  pipeline: 15,
  participation: 20,
  dues: 10,
  followThrough: 10,
} as const;

export const CLUB_THRESHOLDS = { healthy: 70, watch: 45 } as const;

/**
 * Has this club recorded anything at all?
 *
 * Distinguishes "we have no idea how they're doing" from "they're doing
 * badly" — two situations that produce identical numbers and need opposite
 * responses.
 */
function isUnstarted(f: ClubFacts): boolean {
  return (
    f.daysSinceLastActivity === null &&
    f.attendanceRate90d === null &&
    f.activeProspects === 0 &&
    f.activeProjects === 0 &&
    f.membersOnCommittees === 0 &&
    f.membersOnProjects === 0 &&
    f.netChange90d === 0 &&
    f.departures365d === 0
  );
}

export function scoreClubHealth(f: ClubFacts): ScoreResult<HealthStatus> {
  const drivers: Driver[] = [];
  const reasons: string[] = [];
  const actions: string[] = [];
  const members = Math.max(f.memberCount, 1);

  // ── Attendance ──
  // A club that records no attendance gets most of the credit rather than a
  // zero. Not tracking is a data gap, and scoring it like an empty room would
  // tell every new club it's failing on its first day.
  if (f.attendanceRate90d === null) {
    drivers.push({
      key: "attendance",
      label: "Attendance isn't being recorded yet",
      value: "no data",
      points: round(CLUB_WEIGHTS.attendance * 0.6),
      max: CLUB_WEIGHTS.attendance,
    });
    actions.push("Start taking attendance at meetings — it's the single most useful thing to track.");
  } else {
    // 50% attendance earns nothing, 85% earns full marks. Rotary norms sit
    // around 60–75%; 85% is a genuinely strong club, not an unreachable bar.
    let points = award(f.attendanceRate90d, 0.5, 0.85, CLUB_WEIGHTS.attendance);
    let label = `Typical attendance is ${pct(f.attendanceRate90d)}`;

    if (f.attendanceRatePrior90d !== null) {
      const delta = f.attendanceRate90d - f.attendanceRatePrior90d;
      if (delta <= -0.1) {
        // A falling trend is worse news than a low-but-steady number.
        points = round(Math.max(0, points - CLUB_WEIGHTS.attendance * 0.25));
        label += `, down from ${pct(f.attendanceRatePrior90d)}`;
        reasons.push("Attendance has dropped noticeably since last quarter.");
        actions.push("Ask three members who've stopped coming what changed. Not a survey — a phone call.");
      } else if (delta >= 0.1) {
        label += `, up from ${pct(f.attendanceRatePrior90d)}`;
      }
    }
    if (f.attendanceRate90d < 0.5) {
      reasons.push("Fewer than half of members are showing up.");
    }
    drivers.push({ key: "attendance", label, value: pct(f.attendanceRate90d), points, max: CLUB_WEIGHTS.attendance });
  }

  // ── Growth ──
  // Judged relative to club size: losing two members is routine for a club of
  // 90 and serious for a club of 12.
  const netRate = f.netChange90d / members;
  const growthPoints = award(netRate, -0.05, 0.05, CLUB_WEIGHTS.growth);
  drivers.push({
    key: "growth",
    label:
      f.netChange90d > 0 ? `Up ${f.netChange90d} member${f.netChange90d === 1 ? "" : "s"} in 90 days`
      : f.netChange90d < 0 ? `Down ${Math.abs(f.netChange90d)} member${f.netChange90d === -1 ? "" : "s"} in 90 days`
      : "Membership is level over 90 days",
    value: `${f.netChange90d >= 0 ? "+" : ""}${f.netChange90d}`,
    points: growthPoints,
    max: CLUB_WEIGHTS.growth,
  });
  if (netRate <= -0.05) {
    reasons.push(`The club has lost ${Math.abs(f.netChange90d)} members in three months.`);
  }
  if (f.departures365d / members >= 0.2) {
    reasons.push(`Roughly ${pct(f.departures365d / members)} of the club has left in the past year.`);
    actions.push("Look at the exit reasons on this year's departures — the pattern is usually one thing.");
  }

  // ── Pipeline ──
  // Prospects, scaled to club size. A club of 60 needs more in flight than a
  // club of 15 just to stand still.
  const pipelineTarget = Math.max(2, Math.round(members * 0.08));
  const pipelinePoints = award(f.activeProspects, 0, pipelineTarget, CLUB_WEIGHTS.pipeline);
  drivers.push({
    key: "pipeline",
    label:
      f.activeProspects === 0
        ? "No prospective members in conversation"
        : `${f.activeProspects} prospective member${f.activeProspects === 1 ? "" : "s"} in conversation`,
    value: `${f.activeProspects} of ~${pipelineTarget}`,
    points: pipelinePoints,
    max: CLUB_WEIGHTS.pipeline,
  });
  if (f.activeProspects === 0) {
    reasons.push("Nobody is currently being invited in.");
    actions.push(
      f.guests90d > 0
        ? `${f.guests90d} guest${f.guests90d === 1 ? " has" : "s have"} visited recently and none were followed up. Start there.`
        : "Ask each member to bring one guest before the end of the quarter.",
    );
  }

  // ── Participation ──
  // Breadth, not headcount: the question is what share of members do something
  // beyond turning up. This is the strongest predictor that a member stays.
  //
  // Clamped at 1: these counts arrive from separate queries and can briefly
  // exceed the member count — a committee seat outliving a resignation, an
  // import landing mid-run. Left unclamped, that inflates the score, which is
  // the one direction an error must never go.
  const committeeShare = clamp(f.membersOnCommittees / members, 0, 1);
  const projectShare = clamp(f.membersOnProjects / members, 0, 1);
  const breadth = (committeeShare + projectShare) / 2;
  let participationPoints = award(breadth, 0.1, 0.55, CLUB_WEIGHTS.participation);
  if (f.activeProjects === 0) {
    participationPoints = round(Math.max(0, participationPoints - CLUB_WEIGHTS.participation * 0.3));
  }
  drivers.push({
    key: "participation",
    label:
      f.activeProjects === 0
        ? `${pct(committeeShare)} on committees, no service projects underway`
        : `${pct(committeeShare)} on committees, ${pct(projectShare)} on projects`,
    value: `${f.activeProjects} active project${f.activeProjects === 1 ? "" : "s"}`,
    points: participationPoints,
    max: CLUB_WEIGHTS.participation,
  });
  if (f.activeProjects === 0) {
    reasons.push("No service project has been active in six months.");
    actions.push("Pick one small project with a date on it. Momentum matters more than scale.");
  }
  if (breadth < 0.2 && f.activeProjects > 0) {
    reasons.push("Most members aren't involved beyond attending.");
    actions.push("Ask five quiet members to join one committee each. People stay where they're needed.");
  }

  // ── Dues ──
  if (f.duesDelinquentRate === null) {
    drivers.push({
      key: "dues",
      label: "Dues aren't tracked here",
      value: "no data",
      points: round(CLUB_WEIGHTS.dues * 0.6),
      max: CLUB_WEIGHTS.dues,
    });
  } else {
    const points = award(1 - f.duesDelinquentRate, 0.75, 0.97, CLUB_WEIGHTS.dues);
    drivers.push({
      key: "dues",
      label:
        f.duesDelinquentRate <= 0.03
          ? "Dues are essentially current"
          : `${pct(f.duesDelinquentRate)} of dues are past due`,
      value: pct(f.duesDelinquentRate),
      points,
      max: CLUB_WEIGHTS.dues,
    });
    // Unpaid dues are usually a symptom, not a cause. Someone drifting away
    // stops paying before they resign.
    if (f.duesDelinquentRate >= 0.2) {
      reasons.push("A fifth of the club is behind on dues — often the first sign someone's drifting.");
      actions.push("Call the members behind on dues before sending another reminder.");
    }
  }

  // ── Follow-through ──
  // Does the club act on what it already knows? A club with at-risk members
  // and no outreach is in more trouble than one with more at-risk members
  // who's calling all of them.
  if (f.atRiskMembers === 0) {
    drivers.push({
      key: "follow_through",
      label: "No members are currently flagged at risk",
      value: "0 flagged",
      points: CLUB_WEIGHTS.followThrough,
      max: CLUB_WEIGHTS.followThrough,
    });
  } else {
    const covered = f.atRiskMembersTouched / f.atRiskMembers;
    drivers.push({
      key: "follow_through",
      label: `${f.atRiskMembersTouched} of ${f.atRiskMembers} at-risk members have been contacted recently`,
      value: pct(covered),
      points: award(covered, 0, 0.8, CLUB_WEIGHTS.followThrough),
      max: CLUB_WEIGHTS.followThrough,
    });
    if (covered < 0.5) {
      const untouched = f.atRiskMembers - f.atRiskMembersTouched;
      reasons.push(`${untouched} member${untouched === 1 ? " who's" : "s who are"} drifting hasn't been contacted.`);
      actions.push("Split the at-risk list across the board. One call each, this week.");
    }
  }

  let score = Math.round(drivers.reduce((s, d) => s + d.points, 0));

  // A club that has never recorded anything is not a failing club — it is a
  // club that signed up on Tuesday. Every input above reads as a zero, and the
  // arithmetic lands on "at risk", which is a judgement we have not earned and
  // a terrible first screen. Hold it at "watch", say plainly that we don't know
  // yet, and give it something to do.
  if (isUnstarted(f)) {
    score = Math.max(score, CLUB_THRESHOLDS.watch);
    reasons.length = 0;
    reasons.push("There isn't enough recorded yet to say how this club is doing.");
    actions.unshift("Add your members, then record one meeting. That's enough to start seeing the picture.");
  } else if (f.daysSinceLastActivity !== null && f.daysSinceLastActivity > 60) {
    // Distinct from the case above: this club *was* recording and stopped.
    // A dormant account and an empty one look identical from here, and both
    // need attention — but only this one has lost something.
    score = Math.min(score, CLUB_THRESHOLDS.watch - 1);
    reasons.unshift(`Nothing has been recorded in ${f.daysSinceLastActivity} days.`);
    actions.unshift("Log this week's meeting. The club can't be seen if nothing's written down.");
  }

  score = clamp(score, 0, 100);
  const status: HealthStatus =
    score >= CLUB_THRESHOLDS.healthy ? "healthy" : score >= CLUB_THRESHOLDS.watch ? "watch" : "at_risk";

  return { score, status, drivers, reasons: reasons.slice(0, 4), actions: actions.slice(0, 3) };
}

// ── Member engagement ─────────────────────────────────────────────────────────

export interface MemberFacts {
  /** Days since this member last attended a meeting. Null = never recorded. */
  daysSinceAttended: number | null;
  /** Share of this club's meetings attended in 90 days, 0–1. Null if unknown. */
  attendanceRate90d: number | null;
  /**
   * Days since they turned up to a club event — the auction, the golf day, the
   * social. Null = never, or never recorded.
   *
   * Separate from `daysSinceAttended` because the two are different facts and
   * merging them upstream would hide which one is true. The member who never
   * makes a Tuesday but runs the fundraiser every year is the exact false
   * positive that costs a club its trust in this score, and this is the field
   * that fixes it.
   */
  daysSinceEvent: number | null;
  /** Club events attended in the last 180 days. */
  eventCount: number;
  /**
   * Times they booked a place and didn't come, in the last 180 days.
   *
   * Not scored. It is a reason, not a penalty: somebody who meant to come
   * twice and didn't is worth a phone call, and docking them points for it
   * would be punishing the intention we want more of.
   */
  eventNoShows: number;
  /** Days since any interaction was logged with them. Null = never. */
  daysSinceTouch: number | null;
  committeeCount: number;
  /** Projects participated in over the last 180 days. */
  projectCount: number;
  duesCurrent: boolean;
  /** Days since they joined this club. Drives the new-member grace period. */
  daysSinceJoined: number;
  /** Honorary and corporate members are not expected to attend weekly. */
  membershipType: "active" | "honorary" | "corporate" | "satellite";
  /** True if the member has an approved leave of absence. */
  onLeave: boolean;
}

export const MEMBER_WEIGHTS = {
  attendance: 40,
  participation: 25,
  connection: 20,
  dues: 10,
  tenure: 5,
} as const;

export const MEMBER_THRESHOLDS = { steady: 60, watch: 35 } as const;

/** New members get room to settle before anyone calls them at risk. */
export const NEW_MEMBER_GRACE_DAYS = 90;

export function scoreMemberEngagement(f: MemberFacts): ScoreResult<RiskLevel> {
  const drivers: Driver[] = [];
  const reasons: string[] = [];
  const actions: string[] = [];

  // A member on approved leave is not drifting. They told us. Scoring them as
  // at-risk would generate exactly the outreach they asked us not to send.
  if (f.onLeave) {
    return {
      score: MEMBER_THRESHOLDS.steady,
      status: "steady",
      drivers: [{
        key: "leave",
        label: "On an approved leave of absence",
        value: "on leave",
        points: MEMBER_THRESHOLDS.steady,
        max: 100,
      }],
      reasons: [],
      actions: ["Note when their leave ends so someone welcomes them back."],
    };
  }

  const relaxedAttendance = f.membershipType === "honorary" || f.membershipType === "corporate";

  // How long since anyone in this club actually saw them, by whichever route.
  // A club night counts as being seen. Everything below asks "when were they
  // last here", and answering that with meetings alone was wrong.
  const daysSinceSeen = nearest(f.daysSinceAttended, f.daysSinceEvent);
  const seenAtEvent =
    f.daysSinceEvent !== null &&
    (f.daysSinceAttended === null || f.daysSinceEvent < f.daysSinceAttended);

  // ── Attendance ──
  if (relaxedAttendance) {
    // Honorary and corporate members aren't expected weekly. Judging them by
    // the same yardstick would flood the at-risk list with people who are
    // exactly where everyone agreed they'd be.
    drivers.push({
      key: "attendance",
      label: `${f.membershipType === "honorary" ? "Honorary" : "Corporate"} member — weekly attendance isn't expected`,
      value: "n/a",
      points: round(MEMBER_WEIGHTS.attendance * 0.75),
      max: MEMBER_WEIGHTS.attendance,
    });
  } else if (daysSinceSeen === null) {
    drivers.push({
      key: "attendance",
      label: f.daysSinceJoined <= NEW_MEMBER_GRACE_DAYS
        ? "Hasn't been to a meeting yet — still new"
        : "No attendance on record",
      value: "never",
      points: f.daysSinceJoined <= NEW_MEMBER_GRACE_DAYS ? round(MEMBER_WEIGHTS.attendance * 0.5) : 0,
      max: MEMBER_WEIGHTS.attendance,
    });
    if (f.daysSinceJoined > NEW_MEMBER_GRACE_DAYS) {
      reasons.push("They've never been marked present at a meeting.");
      actions.push("Check whether they were ever properly welcomed — this is often a records gap, not a person gap.");
    }
  } else {
    // Recency does most of the work. 14 days is normal for a weekly club;
    // past 60 days somebody has quietly stopped coming.
    const recency = award(-daysSinceSeen, -70, -14, MEMBER_WEIGHTS.attendance * 0.6);
    // The rate stays a *meeting* rate. Events are irregular by nature, so
    // folding them into a percentage would produce a number that means
    // nothing — "attended 100% of the one thing we held" is not a fact worth
    // scoring. Recency is where they belong.
    const rate = f.attendanceRate90d === null
      ? MEMBER_WEIGHTS.attendance * 0.4 * 0.5
      : award(f.attendanceRate90d, 0.2, 0.7, MEMBER_WEIGHTS.attendance * 0.4);
    drivers.push({
      key: "attendance",
      label:
        seenAtEvent && f.daysSinceEvent !== null
          ? f.daysSinceEvent <= 45
            ? `At a club event ${f.daysSinceEvent} days ago, though not a recent meeting`
            : `Last seen at a club event ${f.daysSinceEvent} days ago`
        : daysSinceSeen <= 14 ? "Attending regularly"
        : daysSinceSeen <= 45 ? `Last seen ${daysSinceSeen} days ago`
        : `Hasn't attended in ${daysSinceSeen} days`,
      value: f.attendanceRate90d === null ? `${daysSinceSeen}d ago` : pct(f.attendanceRate90d),
      points: round(recency + rate),
      max: MEMBER_WEIGHTS.attendance,
    });
    if (daysSinceSeen >= 60) {
      reasons.push(`Nobody has seen them at anything in ${daysSinceSeen} days.`);
      actions.push("A short personal note beats another club-wide email. Ask how they're doing, not where they've been.");
    }
  }

  // ── Participation ──
  // A member on a committee or a project is markedly more likely to still be
  // here next year. This is the lever a club can actually pull.
  //
  // Turning up to club events counts for half a seat each, and stops short of
  // the full award. Half, because coming to the auction is not the same as
  // being responsible for it; capped below the maximum, because a member who
  // buys a ticket to everything and holds no role is a real and recognisable
  // pattern, and it must not read as the most involved person in the club.
  const eventCredit = Math.min(f.eventCount, 3) * 0.5;
  const involvement = f.committeeCount + f.projectCount + eventCredit;
  drivers.push({
    key: "participation",
    label: involvement === 0
      ? "Not on a committee or a project"
      : involvementLabel(f.committeeCount, f.projectCount, f.eventCount),
    value: String(round(involvement)),
    points: award(involvement, 0, 2, MEMBER_WEIGHTS.participation),
    max: MEMBER_WEIGHTS.participation,
  });
  if (involvement === 0 && f.daysSinceJoined > NEW_MEMBER_GRACE_DAYS) {
    reasons.push("They aren't involved in anything beyond meetings.");
    actions.push("Invite them onto one committee. Being needed is what makes people stay.");
  }

  // A no-show is not a penalty — see MemberFacts. It is the earliest visible
  // sign of the drift this score exists to catch, and it earns a phone call
  // rather than a deduction. Two is a pattern; one is a Tuesday.
  if (f.eventNoShows >= 2) {
    reasons.push(`They've booked ${f.eventNoShows} club events and not come.`);
    actions.push("Ring them before the next one. Booking and not coming usually means something changed.");
  }

  // ── Connection ──
  if (f.daysSinceTouch === null) {
    drivers.push({
      key: "connection",
      label: "No conversation has ever been logged with them",
      value: "never",
      points: 0,
      max: MEMBER_WEIGHTS.connection,
    });
    reasons.push("Nobody has recorded a conversation with them.");
  } else {
    drivers.push({
      key: "connection",
      label:
        f.daysSinceTouch <= 30 ? "Someone's been in touch recently"
        : `Last conversation was ${f.daysSinceTouch} days ago`,
      value: `${f.daysSinceTouch}d`,
      points: award(-f.daysSinceTouch, -180, -30, MEMBER_WEIGHTS.connection),
      max: MEMBER_WEIGHTS.connection,
    });
  }

  // ── Dues ──
  drivers.push({
    key: "dues",
    label: f.duesCurrent ? "Dues are current" : "Dues are past due",
    value: f.duesCurrent ? "current" : "past due",
    points: f.duesCurrent ? MEMBER_WEIGHTS.dues : 0,
    max: MEMBER_WEIGHTS.dues,
  });

  // ── Tenure ──
  // Long-standing members get a small, honest allowance. Twenty years of
  // showing up earns more benefit of the doubt than a quiet quarter removes.
  const years = f.daysSinceJoined / 365;
  drivers.push({
    key: "tenure",
    label:
      years >= 1 ? `${Math.floor(years)} year${Math.floor(years) === 1 ? "" : "s"} in this club`
      : "Joined within the past year",
    value: `${Math.floor(years)}y`,
    points: award(years, 0, 10, MEMBER_WEIGHTS.tenure),
    max: MEMBER_WEIGHTS.tenure,
  });

  let score = Math.round(drivers.reduce((s, d) => s + d.points, 0));

  // Grace period. A member who joined six weeks ago has no history by
  // definition, and flagging them at risk is both wrong and a bad welcome.
  if (f.daysSinceJoined <= NEW_MEMBER_GRACE_DAYS) {
    score = Math.max(score, MEMBER_THRESHOLDS.watch);
    if (involvement === 0) {
      actions.length = 0;
      actions.push("Still finding their feet. Pair them with a mentor and get them onto a project.");
    }
  }

  score = clamp(score, 0, 100);
  const status: RiskLevel =
    score >= MEMBER_THRESHOLDS.steady ? "steady" : score >= MEMBER_THRESHOLDS.watch ? "watch" : "at_risk";

  return { score, status, drivers, reasons: reasons.slice(0, 3), actions: actions.slice(0, 2) };
}
