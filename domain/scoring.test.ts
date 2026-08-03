/**
 * scoring.test.ts
 *
 * These tests are the specification. The arithmetic is easy; the judgements are
 * not, and each one below is a decision about how a club gets treated:
 *
 *   - A brand-new club with no data is not a failing club.
 *   - A member on approved leave is not drifting.
 *   - An honorary member who doesn't attend weekly is exactly where everyone
 *     agreed they'd be.
 *   - A six-week-old member has no history by definition, and flagging them
 *     is a bad welcome as well as a wrong answer.
 *
 * Getting these wrong doesn't produce a broken report. It produces a club that
 * stops trusting the tool, which is worse.
 */
import { describe, it, expect } from "vitest";
import {
  scoreClubHealth, scoreMemberEngagement,
  CLUB_WEIGHTS, MEMBER_WEIGHTS, CLUB_THRESHOLDS, MEMBER_THRESHOLDS,
  NEW_MEMBER_GRACE_DAYS,
  type ClubFacts, type MemberFacts,
} from "./scoring";

// A mid-sized club doing fine. Individual tests vary one thing at a time.
const HEALTHY_CLUB: ClubFacts = {
  memberCount: 45,
  netChange90d: 2,
  departures90d: 1,
  departures365d: 4,
  attendanceRate90d: 0.72,
  attendanceRatePrior90d: 0.70,
  activeProspects: 4,
  guests90d: 6,
  membersOnCommittees: 27,
  membersOnProjects: 22,
  activeProjects: 3,
  duesDelinquentRate: 0.04,
  atRiskMembers: 2,
  atRiskMembersTouched: 2,
  daysSinceLastActivity: 2,
};

const club = (over: Partial<ClubFacts> = {}): ClubFacts => ({ ...HEALTHY_CLUB, ...over });

const STEADY_MEMBER: MemberFacts = {
  daysSinceAttended: 7,
  attendanceRate90d: 0.75,
  daysSinceTouch: 20,
  committeeCount: 1,
  projectCount: 1,
  duesCurrent: true,
  daysSinceJoined: 1500,
  membershipType: "active",
  onLeave: false,
};

const member = (over: Partial<MemberFacts> = {}): MemberFacts => ({ ...STEADY_MEMBER, ...over });

// ── Structural invariants ─────────────────────────────────────────────────────

describe("weights", () => {
  it("club weights sum to 100, so the score is a percentage and not a mystery", () => {
    expect(Object.values(CLUB_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it("member weights sum to 100", () => {
    expect(Object.values(MEMBER_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("every score explains itself", () => {
  it("returns a driver for each weighted component", () => {
    const r = scoreClubHealth(club());
    expect(r.drivers.map((d) => d.key).sort()).toEqual(
      ["attendance", "dues", "follow_through", "growth", "participation", "pipeline"],
    );
  });

  it("never awards more points than a driver has available", () => {
    for (const facts of [club(), club({ attendanceRate90d: 1, netChange90d: 20, activeProspects: 50 })]) {
      for (const d of scoreClubHealth(facts).drivers) {
        expect(d.points).toBeLessThanOrEqual(d.max);
        expect(d.points).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("writes driver labels a human can read, not field names", () => {
    for (const d of scoreClubHealth(club()).drivers) {
      expect(d.label).not.toMatch(/_/);
      expect(d.label.length).toBeGreaterThan(8);
    }
  });

  it("gives a reason for every struggling club, and an action to go with it", () => {
    const r = scoreClubHealth(club({
      attendanceRate90d: 0.3, netChange90d: -6, activeProspects: 0,
      activeProjects: 0, membersOnCommittees: 3, membersOnProjects: 1,
      duesDelinquentRate: 0.35, atRiskMembers: 8, atRiskMembersTouched: 0,
    }));
    expect(r.status).toBe("at_risk");
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.actions.length).toBeGreaterThan(0);
  });

  it("keeps the reason list short enough to act on", () => {
    const r = scoreClubHealth(club({
      attendanceRate90d: 0.2, attendanceRatePrior90d: 0.6, netChange90d: -10,
      departures365d: 20, activeProspects: 0, activeProjects: 0,
      membersOnCommittees: 0, membersOnProjects: 0, duesDelinquentRate: 0.5,
      atRiskMembers: 10, atRiskMembersTouched: 0, daysSinceLastActivity: 100,
    }));
    expect(r.reasons.length).toBeLessThanOrEqual(4);
    expect(r.actions.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic — the same facts always give the same score", () => {
    const facts = club();
    const first = scoreClubHealth(facts);
    for (let i = 0; i < 20; i++) expect(scoreClubHealth(facts)).toEqual(first);
  });

  it("does not mutate the facts it is given", () => {
    const facts = club();
    const snapshot = structuredClone(facts);
    scoreClubHealth(facts);
    expect(facts).toEqual(snapshot);
  });
});

// ── Club health ───────────────────────────────────────────────────────────────

describe("club health", () => {
  it("calls a well-run club healthy", () => {
    const r = scoreClubHealth(club());
    expect(r.status).toBe("healthy");
    expect(r.score).toBeGreaterThanOrEqual(CLUB_THRESHOLDS.healthy);
  });

  it("does not punish a brand-new club for having no data", () => {
    // Day one: nothing recorded anywhere. This club is not failing, and telling
    // it so on the first screen it ever sees is how you lose it.
    const r = scoreClubHealth(club({
      memberCount: 12, netChange90d: 0, departures90d: 0, departures365d: 0,
      attendanceRate90d: null, attendanceRatePrior90d: null,
      activeProspects: 0, guests90d: 0,
      membersOnCommittees: 0, membersOnProjects: 0, activeProjects: 0,
      duesDelinquentRate: null, atRiskMembers: 0, atRiskMembersTouched: 0,
      daysSinceLastActivity: null,
    }));
    expect(r.status).not.toBe("at_risk");
    // And it says so plainly, rather than implying the club is doing badly.
    expect(r.reasons.join(" ")).toMatch(/isn't enough recorded yet/i);
    expect(r.actions.join(" ")).toMatch(/add your members/i);
  });

  it("distinguishes a club that never started from one that went quiet", () => {
    // Same absence of recent data, opposite meanings: one has lost nothing,
    // the other has stopped.
    const neverStarted = scoreClubHealth(club({
      memberCount: 12, netChange90d: 0, departures90d: 0, departures365d: 0,
      attendanceRate90d: null, attendanceRatePrior90d: null,
      activeProspects: 0, guests90d: 0, membersOnCommittees: 0,
      membersOnProjects: 0, activeProjects: 0, duesDelinquentRate: null,
      atRiskMembers: 0, atRiskMembersTouched: 0, daysSinceLastActivity: null,
    }));
    const wentQuiet = scoreClubHealth(club({ daysSinceLastActivity: 120 }));
    expect(neverStarted.reasons.join(" ")).toMatch(/isn't enough recorded/i);
    expect(wentQuiet.reasons.join(" ")).toMatch(/120 days/);
  });

  it("does not let stale counts inflate participation above the whole club", () => {
    // These counts come from separate queries and can briefly disagree — a
    // committee seat outliving a resignation, an import landing mid-run. The
    // score must not go up because of it.
    const consistent = scoreClubHealth(club({ memberCount: 20, membersOnCommittees: 20, membersOnProjects: 20 }));
    const skewed = scoreClubHealth(club({ memberCount: 20, membersOnCommittees: 60, membersOnProjects: 90 }));
    expect(skewed.score).toBe(consistent.score);
  });

  it("treats a falling attendance trend as worse than a low steady one", () => {
    const steady = scoreClubHealth(club({ attendanceRate90d: 0.55, attendanceRatePrior90d: 0.55 }));
    const falling = scoreClubHealth(club({ attendanceRate90d: 0.55, attendanceRatePrior90d: 0.75 }));
    expect(falling.score).toBeLessThan(steady.score);
    expect(falling.reasons.join(" ")).toMatch(/dropped/i);
  });

  it("judges membership loss relative to club size", () => {
    // Losing three members is routine at 90 and serious at 12. Everything
    // proportional is held constant so only size and the loss differ —
    // otherwise the small club wins on ratios and the comparison is meaningless.
    const sized = (memberCount: number, netChange90d: number): ClubFacts => club({
      memberCount,
      netChange90d,
      departures90d: Math.abs(netChange90d),
      departures365d: Math.abs(netChange90d),
      membersOnCommittees: Math.round(memberCount * 0.6),
      membersOnProjects: Math.round(memberCount * 0.5),
      activeProspects: Math.max(2, Math.round(memberCount * 0.08)),
    });
    const big = scoreClubHealth(sized(90, -3));
    const small = scoreClubHealth(sized(12, -3));
    expect(small.score).toBeLessThan(big.score);

    // And the same proportional loss scores the same at either size.
    expect(scoreClubHealth(sized(90, -9)).score).toBe(scoreClubHealth(sized(12, -1)).score);
  });

  it("scales the pipeline target to club size", () => {
    // Four prospects is healthy for a small club and thin for a large one.
    const small = scoreClubHealth(club({ memberCount: 15, activeProspects: 4 }));
    const large = scoreClubHealth(club({ memberCount: 120, activeProspects: 4 }));
    const p = (r: ReturnType<typeof scoreClubHealth>) =>
      r.drivers.find((d) => d.key === "pipeline")!.points;
    expect(p(small)).toBeGreaterThan(p(large));
  });

  it("points an empty pipeline at the guests already in the building", () => {
    const r = scoreClubHealth(club({ activeProspects: 0, guests90d: 5 }));
    expect(r.actions.join(" ")).toMatch(/guest/i);
  });

  it("suggests inviting guests when there aren't any", () => {
    const r = scoreClubHealth(club({ activeProspects: 0, guests90d: 0 }));
    expect(r.actions.join(" ")).toMatch(/bring one guest/i);
  });

  it("notices a club with no service project underway", () => {
    const r = scoreClubHealth(club({ activeProjects: 0, membersOnProjects: 0 }));
    expect(r.reasons.join(" ")).toMatch(/service project/i);
    expect(r.score).toBeLessThan(scoreClubHealth(club()).score);
  });

  it("rewards acting on at-risk members over merely having few", () => {
    const acting = scoreClubHealth(club({ atRiskMembers: 8, atRiskMembersTouched: 7 }));
    const ignoring = scoreClubHealth(club({ atRiskMembers: 3, atRiskMembersTouched: 0 }));
    const ft = (r: ReturnType<typeof scoreClubHealth>) =>
      r.drivers.find((d) => d.key === "follow_through")!.points;
    expect(ft(acting)).toBeGreaterThan(ft(ignoring));
  });

  it("reads unpaid dues as a drift signal, not just a money problem", () => {
    const r = scoreClubHealth(club({ duesDelinquentRate: 0.28 }));
    expect(r.reasons.join(" ")).toMatch(/drifting/i);
    expect(r.actions.join(" ")).toMatch(/call/i);
  });

  it("caps a dormant club below healthy however good its stale numbers look", () => {
    // Everything on record is excellent, but nothing has been recorded in
    // three months. That is a dormant account, not a thriving club.
    const r = scoreClubHealth(club({ daysSinceLastActivity: 95 }));
    expect(r.status).not.toBe("healthy");
    expect(r.reasons[0]).toMatch(/95 days/);
  });

  it("survives a club with no members without dividing by zero", () => {
    const r = scoreClubHealth(club({
      memberCount: 0, membersOnCommittees: 0, membersOnProjects: 0,
      netChange90d: 0, departures365d: 0,
    }));
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("keeps the score inside 0–100 at both extremes", () => {
    const best = scoreClubHealth(club({
      attendanceRate90d: 1, attendanceRatePrior90d: 0.5, netChange90d: 40,
      activeProspects: 100, membersOnCommittees: 45, membersOnProjects: 45,
      activeProjects: 20, duesDelinquentRate: 0, atRiskMembers: 0,
      atRiskMembersTouched: 0, daysSinceLastActivity: 0,
    }));
    const worst = scoreClubHealth(club({
      attendanceRate90d: 0, attendanceRatePrior90d: 1, netChange90d: -45,
      departures365d: 45, activeProspects: 0, guests90d: 0,
      membersOnCommittees: 0, membersOnProjects: 0, activeProjects: 0,
      duesDelinquentRate: 1, atRiskMembers: 20, atRiskMembersTouched: 0,
      daysSinceLastActivity: 400,
    }));
    expect(best.score).toBeLessThanOrEqual(100);
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(best.status).toBe("healthy");
    expect(worst.status).toBe("at_risk");
  });
});

// ── Member engagement ─────────────────────────────────────────────────────────

describe("member engagement", () => {
  it("calls an involved regular steady", () => {
    const r = scoreMemberEngagement(member());
    expect(r.status).toBe("steady");
    expect(r.score).toBeGreaterThanOrEqual(MEMBER_THRESHOLDS.steady);
  });

  it("flags someone who has quietly stopped coming", () => {
    const r = scoreMemberEngagement(member({
      daysSinceAttended: 95, attendanceRate90d: 0.05,
      daysSinceTouch: 120, committeeCount: 0, projectCount: 0,
    }));
    expect(r.status).toBe("at_risk");
    expect(r.reasons.join(" ")).toMatch(/95 days/);
  });

  it("asks how they are, not where they've been", () => {
    const r = scoreMemberEngagement(member({ daysSinceAttended: 80, attendanceRate90d: 0.1 }));
    const advice = r.actions.join(" ");
    expect(advice).toMatch(/how they'?re doing/i);
    // No guilt, no chasing, no "we've noticed you've been absent".
    expect(advice).not.toMatch(/remind|chase|warn|missed/i);
  });

  // The single most important behaviour in this file.
  it("never flags a member on approved leave — they told us", () => {
    const r = scoreMemberEngagement(member({
      onLeave: true,
      daysSinceAttended: 200, attendanceRate90d: 0, daysSinceTouch: 300,
      committeeCount: 0, projectCount: 0, duesCurrent: false,
    }));
    expect(r.status).toBe("steady");
    expect(r.reasons).toEqual([]);
    expect(r.actions.join(" ")).toMatch(/welcomes them back/i);
  });

  it("does not hold an honorary member to a weekly-attendance standard", () => {
    const honorary = scoreMemberEngagement(member({
      membershipType: "honorary", daysSinceAttended: 120, attendanceRate90d: 0.05,
    }));
    const active = scoreMemberEngagement(member({
      membershipType: "active", daysSinceAttended: 120, attendanceRate90d: 0.05,
    }));
    expect(honorary.score).toBeGreaterThan(active.score);
    expect(honorary.status).not.toBe("at_risk");
  });

  it("treats corporate members the same way", () => {
    const r = scoreMemberEngagement(member({
      membershipType: "corporate", daysSinceAttended: 100, attendanceRate90d: 0.1,
    }));
    expect(r.drivers.find((d) => d.key === "attendance")!.label).toMatch(/isn't expected/i);
  });

  it("gives a new member room to settle rather than a risk flag", () => {
    // Six weeks in, no attendance recorded, nobody's logged a chat. That is a
    // normal first month and a half, not a person on their way out.
    const r = scoreMemberEngagement(member({
      daysSinceJoined: 42,
      daysSinceAttended: null, attendanceRate90d: null, daysSinceTouch: null,
      committeeCount: 0, projectCount: 0,
    }));
    expect(r.status).not.toBe("at_risk");
    expect(r.actions.join(" ")).toMatch(/mentor/i);
  });

  it("stops extending grace once the settling-in period is over", () => {
    const inGrace = scoreMemberEngagement(member({
      daysSinceJoined: NEW_MEMBER_GRACE_DAYS - 1,
      daysSinceAttended: null, attendanceRate90d: null, daysSinceTouch: null,
      committeeCount: 0, projectCount: 0,
    }));
    const past = scoreMemberEngagement(member({
      daysSinceJoined: NEW_MEMBER_GRACE_DAYS + 120,
      daysSinceAttended: null, attendanceRate90d: null, daysSinceTouch: null,
      committeeCount: 0, projectCount: 0,
    }));
    expect(inGrace.status).not.toBe("at_risk");
    expect(past.status).toBe("at_risk");
  });

  it("reads 'never attended' after a year as a records gap worth checking", () => {
    const r = scoreMemberEngagement(member({
      daysSinceJoined: 500, daysSinceAttended: null, attendanceRate90d: null,
    }));
    expect(r.actions.join(" ")).toMatch(/records gap/i);
  });

  it("values being on a committee or a project", () => {
    const involved = scoreMemberEngagement(member({ committeeCount: 2, projectCount: 1 }));
    const not = scoreMemberEngagement(member({ committeeCount: 0, projectCount: 0 }));
    expect(involved.score).toBeGreaterThan(not.score);
    expect(not.actions.join(" ")).toMatch(/committee/i);
  });

  it("says why involvement matters, in words a chair would repeat", () => {
    const r = scoreMemberEngagement(member({ committeeCount: 0, projectCount: 0 }));
    expect(r.actions.join(" ")).toMatch(/needed/i);
  });

  it("gives long tenure a small honest allowance, not immunity", () => {
    const veteran = scoreMemberEngagement(member({ daysSinceJoined: 365 * 25 }));
    const newer = scoreMemberEngagement(member({ daysSinceJoined: 365 * 2 }));
    expect(veteran.score).toBeGreaterThan(newer.score);
    // But twenty years does not survive a total disappearance.
    const vanished = scoreMemberEngagement(member({
      daysSinceJoined: 365 * 25, daysSinceAttended: 300, attendanceRate90d: 0,
      daysSinceTouch: 400, committeeCount: 0, projectCount: 0, duesCurrent: false,
    }));
    expect(vanished.status).toBe("at_risk");
  });

  it("notices when nobody has ever logged a conversation", () => {
    const r = scoreMemberEngagement(member({ daysSinceTouch: null, daysSinceJoined: 900 }));
    expect(r.reasons.join(" ")).toMatch(/conversation/i);
    expect(r.drivers.find((d) => d.key === "connection")!.points).toBe(0);
  });

  it("counts current dues, without making them the story", () => {
    const paid = scoreMemberEngagement(member({ duesCurrent: true }));
    const unpaid = scoreMemberEngagement(member({ duesCurrent: false }));
    expect(paid.score - unpaid.score).toBe(MEMBER_WEIGHTS.dues);
    // Unpaid dues alone must not push an otherwise-engaged member to at-risk.
    expect(unpaid.status).not.toBe("at_risk");
  });

  it("is deterministic and side-effect free", () => {
    const facts = member();
    const snapshot = structuredClone(facts);
    const first = scoreMemberEngagement(facts);
    for (let i = 0; i < 20; i++) expect(scoreMemberEngagement(facts)).toEqual(first);
    expect(facts).toEqual(snapshot);
  });

  it("keeps every score inside 0–100", () => {
    const cases: MemberFacts[] = [
      member(),
      member({ daysSinceAttended: 0, attendanceRate90d: 1, daysSinceTouch: 0, committeeCount: 9, projectCount: 9, daysSinceJoined: 365 * 50 }),
      member({ daysSinceAttended: 9999, attendanceRate90d: 0, daysSinceTouch: 9999, committeeCount: 0, projectCount: 0, duesCurrent: false, daysSinceJoined: 9999 }),
      member({ daysSinceJoined: 0, daysSinceAttended: null, attendanceRate90d: null, daysSinceTouch: null }),
    ];
    for (const c of cases) {
      const r = scoreMemberEngagement(c);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

// ── Tone ──────────────────────────────────────────────────────────────────────

describe("the copy these engines produce", () => {
  const collect = (): string[] => {
    const out: string[] = [];
    const clubCases = [
      club(), club({ activeProspects: 0, guests90d: 0 }), club({ activeProjects: 0 }),
      club({ duesDelinquentRate: 0.4 }), club({ atRiskMembers: 6, atRiskMembersTouched: 0 }),
      club({ daysSinceLastActivity: 120 }), club({ attendanceRate90d: null, duesDelinquentRate: null }),
      club({ attendanceRate90d: 0.4, attendanceRatePrior90d: 0.7 }),
    ];
    for (const c of clubCases) {
      const r = scoreClubHealth(c);
      out.push(...r.reasons, ...r.actions, ...r.drivers.map((d) => d.label));
    }
    const memberCases = [
      member(), member({ onLeave: true }), member({ membershipType: "honorary" }),
      member({ daysSinceJoined: 30, daysSinceAttended: null, attendanceRate90d: null, daysSinceTouch: null }),
      member({ daysSinceAttended: 200, committeeCount: 0, projectCount: 0, duesCurrent: false }),
    ];
    for (const m of memberCases) {
      const r = scoreMemberEngagement(m);
      out.push(...r.reasons, ...r.actions, ...r.drivers.map((d) => d.label));
    }
    return out;
  };

  it("never blames anyone", () => {
    for (const line of collect()) {
      expect(line, line).not.toMatch(/\b(failed|failure|neglect|poor|bad|wrong|guilty|should have)\b/i);
    }
  });

  it("never manufactures urgency", () => {
    for (const line of collect()) {
      expect(line, line).not.toMatch(/\b(urgent|immediately|critical|crisis|act now|warning)\b/i);
    }
  });

  it("stays secular — Rotary is not a church", () => {
    // CROS's copy was devotional by design. None of that vocabulary belongs here.
    for (const line of collect()) {
      expect(line, line).not.toMatch(/\b(blessed|shepherd|ministry|faithful|sacred|beautiful|journey)\b/i);
    }
  });

  it("writes whole sentences, not field names", () => {
    for (const line of collect()) {
      expect(line, line).not.toMatch(/_/);
      expect(line.length, line).toBeGreaterThan(5);
    }
  });
});
