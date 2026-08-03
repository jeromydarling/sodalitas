/**
 * signals.test.ts
 *
 * A weekly list is only useful if a volunteer with an hour actually works it.
 * That makes the interesting tests the ones about restraint: what the generator
 * declines to say, what it groups, what it drops below the cap, and when it
 * stays quiet because it already spoke.
 */
import { describe, it, expect } from "vitest";
import {
  generateClubSignals, rank, rankAll, WEEKLY_SIGNAL_CAP,
  type ClubSignalInput, type MemberFactsForSignal, type GuestFactsForSignal,
  type DuesFactsForSignal, type Signal,
} from "./signals";

const QUIET: ClubSignalInput = {
  clubId: "cl_1",
  clubName: "Rotary Club of Duluth",
  weekStart: "2026-08-03",
  memberCount: 45,
  health: { score: 78, status: "healthy", reasons: [] },
  healthLastWeek: { score: 77, status: "healthy" },
  members: [],
  guests: [],
  overdueDues: [],
  milestones: [],
  vacantOffices: [],
};

const input = (over: Partial<ClubSignalInput> = {}): ClubSignalInput => ({ ...QUIET, ...over });

const member = (over: Partial<MemberFactsForSignal> = {}): MemberFactsForSignal => ({
  personId: "pe_1", name: "Ada Okonkwo", risk: "steady", score: 75,
  daysSinceAttended: 7, daysSinceTouch: 20, reasons: [], hasOpenTask: false,
  anniversaryYears: null, onLeave: false, ...over,
});

const guest = (over: Partial<GuestFactsForSignal> = {}): GuestFactsForSignal => ({
  personId: "pe_g1", name: "Sam Rivera", daysSinceVisit: 10, visitCount: 1,
  hasOpenTask: false, stage: "guest_attended", hostName: null, ...over,
});

const dues = (over: Partial<DuesFactsForSignal> = {}): DuesFactsForSignal => ({
  personId: "pe_d1", name: "Jo Bell", daysOverdue: 45, amountCents: 15000,
  hasOpenTask: false, ...over,
});

const kinds = (s: Signal[]) => s.map((x) => x.kind);

// ── Quiet weeks stay quiet ────────────────────────────────────────────────────

describe("restraint", () => {
  it("says nothing when there is nothing to say", () => {
    expect(generateClubSignals(input())).toEqual([]);
  });

  it("never exceeds the weekly cap", () => {
    const many = input({
      members: Array.from({ length: 40 }, (_, i) =>
        member({ personId: `pe_${i}`, name: `Member ${i}`, risk: "at_risk", daysSinceAttended: 90 }),
      ),
      guests: Array.from({ length: 20 }, (_, i) =>
        guest({ personId: `pe_g${i}`, name: `Guest ${i}` }),
      ),
    });
    expect(generateClubSignals(many).length).toBe(WEEKLY_SIGNAL_CAP);
  });

  it("keeps the cap small enough to finish", () => {
    // Forty signals is a backlog, and a backlog gets closed rather than worked.
    expect(WEEKLY_SIGNAL_CAP).toBeLessThanOrEqual(10);
  });

  it("keeps the highest-value signals when it has to choose", () => {
    const s = generateClubSignals(input({
      guests: [guest()],
      members: [
        member({ personId: "pe_a", risk: "at_risk", daysSinceAttended: 90 }),
        ...Array.from({ length: 20 }, (_, i) =>
          member({ personId: `pe_r${i}`, name: `Quiet ${i}`, daysSinceTouch: 300 }),
        ),
      ],
    }));
    // The guest and the drifting member survive; the long tail of gentle
    // reconnects is what gets cut.
    expect(kinds(s)).toContain("guest_follow_up");
    expect(kinds(s)).toContain("at_risk");
  });

  it("offers the full ranked list separately for anyone who wants it", () => {
    const all = rankAll(Array.from({ length: 30 }, (_, i) => ({
      kind: "reconnect" as const, severity: "info" as const, clubId: "cl_1",
      personId: `pe_${i}`, title: "t", summary: "s", suggestedAction: "a",
      evidence: {}, dedupeKey: `k${i}`, priority: i,
    })));
    expect(all.length).toBe(30);
    expect(all[0]!.priority).toBe(29);
  });
});

// ── Not repeating itself ──────────────────────────────────────────────────────

describe("not nagging", () => {
  it("skips anyone who already has an open task", () => {
    const s = generateClubSignals(input({
      guests: [guest({ hasOpenTask: true })],
      members: [member({ risk: "at_risk", daysSinceAttended: 90, hasOpenTask: true })],
      overdueDues: [dues({ hasOpenTask: true })],
    }));
    expect(s).toEqual([]);
  });

  it("leaves a guest alone for the first couple of days", () => {
    expect(generateClubSignals(input({ guests: [guest({ daysSinceVisit: 1 })] }))).toEqual([]);
    expect(generateClubSignals(input({ guests: [guest({ daysSinceVisit: 5 })] })).length).toBe(1);
  });

  it("stops chasing a guest the club has already moved along", () => {
    for (const stage of ["candidate", "approved", "active", "invited_to_apply"]) {
      expect(generateClubSignals(input({ guests: [guest({ stage })] })), stage).toEqual([]);
    }
  });

  it("only raises club health when the status actually changed", () => {
    const stillWatching = generateClubSignals(input({
      health: { score: 50, status: "watch", reasons: ["Attendance has dropped."] },
      healthLastWeek: { score: 52, status: "watch" },
    }));
    expect(kinds(stillWatching)).not.toContain("club_watch");

    const justSlipped = generateClubSignals(input({
      health: { score: 50, status: "watch", reasons: ["Attendance has dropped."] },
      healthLastWeek: { score: 72, status: "healthy" },
    }));
    expect(kinds(justSlipped)).toContain("club_watch");
  });

  it("says nothing about a club that has always been healthy", () => {
    expect(kinds(generateClubSignals(input()))).not.toContain("club_watch");
  });

  it("groups overdue dues into one signal rather than one per member", () => {
    const s = generateClubSignals(input({
      overdueDues: [
        dues({ personId: "pe_1", name: "A", daysOverdue: 40, amountCents: 10000 }),
        dues({ personId: "pe_2", name: "B", daysOverdue: 95, amountCents: 15000 }),
        dues({ personId: "pe_3", name: "C", daysOverdue: 60, amountCents: 12000 }),
      ],
    }));
    const d = s.filter((x) => x.kind === "dues_overdue");
    expect(d).toHaveLength(1);
    expect(d[0]!.title).toBe("3 members are behind on dues");
    expect(d[0]!.evidence.total_outstanding_cents).toBe(37000);
    expect(d[0]!.evidence.longest_overdue_days).toBe(95);
  });

  it("names the person when only one is behind", () => {
    const s = generateClubSignals(input({ overdueDues: [dues({ name: "Jo Bell", daysOverdue: 45 })] }));
    expect(s[0]!.title).toBe("Jo Bell's dues are 45 days past due");
    expect(s[0]!.personId).toBe("pe_d1");
  });

  it("gives dues a month before mentioning them", () => {
    expect(generateClubSignals(input({ overdueDues: [dues({ daysOverdue: 10 })] }))).toEqual([]);
  });

  it("celebrates every year for five, then only the round ones", () => {
    const years = [1, 2, 5, 7, 10, 13, 25, 31];
    const fired = years.filter((y) =>
      generateClubSignals(input({ members: [member({ anniversaryYears: y })] }))
        .some((s) => s.kind === "anniversary"),
    );
    // Otherwise an eighty-member club drowns in anniversaries.
    expect(fired).toEqual([1, 2, 5, 10, 25]);
  });
});

// ── The judgements ────────────────────────────────────────────────────────────

describe("guests", () => {
  it("treats a recent guest as more urgent than a cold one", () => {
    const recent = generateClubSignals(input({ guests: [guest({ daysSinceVisit: 5 })] }))[0]!;
    const cold = generateClubSignals(input({ guests: [guest({ daysSinceVisit: 60 })] }))[0]!;
    // The window is closing, not closed — that's when a call still works.
    expect(recent.priority).toBeGreaterThan(cold.priority);
    expect(recent.severity).toBe("urgent");
  });

  it("points at the person who hosted them", () => {
    const s = generateClubSignals(input({ guests: [guest({ hostName: "Ada Okonkwo" })] }))[0]!;
    expect(s.suggestedAction).toContain("Ada Okonkwo");
  });

  it("notes a repeat visitor, who is trying to tell the club something", () => {
    const s = generateClubSignals(input({ guests: [guest({ visitCount: 3 })] }))[0]!;
    expect(s.summary).toMatch(/visited 3 times/);
    expect(s.evidence.visits).toBe(3);
  });

  it("asks what they thought, not whether they're joining", () => {
    const s = generateClubSignals(input({ guests: [guest()] }))[0]!;
    expect(s.suggestedAction).toMatch(/what they thought/i);
  });
});

describe("members", () => {
  it("flags someone drifting, without blaming them", () => {
    const s = generateClubSignals(input({
      members: [member({ risk: "at_risk", daysSinceAttended: 95, name: "Bill Nakamura" })],
    }))[0]!;
    expect(s.kind).toBe("at_risk");
    expect(s.summary).toBe("Bill Nakamura hasn't been to a meeting in 95 days.");
    expect(s.suggestedAction).toMatch(/how they are/i);
    expect(s.suggestedAction).toMatch(/not a reminder/i);
  });

  // Found by running the seeded demo and reading what it said. A member who
  // attends every week but sits on no committee, has never been spoken to and
  // is behind on dues is genuinely at risk — the scorer had that right. The
  // signal simply assumed at-risk meant absence, and announced that a man who
  // was there last Thursday "hasn't been to a meeting in 4 days".
  it("does not claim absence for a member who is still turning up", () => {
    const s = generateClubSignals(input({
      members: [member({
        name: "David Whitfield",
        risk: "at_risk",
        score: 29,
        daysSinceAttended: 4,
        daysSinceTouch: null,
        reasons: ["They aren't involved in anything beyond meetings.", "Nobody has recorded a conversation with them."],
      })],
    }))[0]!;

    expect(s.kind).toBe("at_risk");
    expect(s.title).toBe("David Whitfield is here, but not really in");
    expect(s.summary).toContain("still turning up");
    expect(s.summary).toContain("aren't involved in anything");
    expect(s.summary).not.toMatch(/hasn't been to a meeting/);
    // And the advice matches the actual problem. Telling him "we've missed
    // you" would be both wrong and slightly insulting.
    expect(s.suggestedAction).toMatch(/committee or a project/i);
    expect(s.suggestedAction).toMatch(/already in the room/i);
  });

  it("still says 'away' when they genuinely are", () => {
    const s = generateClubSignals(input({
      members: [member({
        name: "Priya Diallo", risk: "at_risk", daysSinceAttended: 109,
        reasons: ["They haven't been to a meeting in 109 days."],
      })],
    }))[0]!;
    expect(s.title).toBe("Priya Diallo has been away a while");
    expect(s.summary).toBe("Priya Diallo hasn't been to a meeting in 109 days.");
    expect(s.suggestedAction).toMatch(/how they are/i);
  });

  it("ranks someone who has vanished above someone merely disengaged", () => {
    const gone = generateClubSignals(input({
      members: [member({ personId: "pe_a", risk: "at_risk", daysSinceAttended: 120 })],
    }))[0]!;
    const present = generateClubSignals(input({
      members: [member({ personId: "pe_b", risk: "at_risk", daysSinceAttended: 3, reasons: ["Not on a committee."] })],
    }))[0]!;
    expect(gone.priority).toBeGreaterThan(present.priority);
  });

  it("carries the full reason list in the evidence, not just the first", () => {
    const s = generateClubSignals(input({
      members: [member({
        risk: "at_risk", daysSinceAttended: 2,
        reasons: ["First reason.", "Second reason."],
      })],
    }))[0]!;
    expect(s.evidence.reasons).toBe("First reason.; Second reason.");
  });

  it("copes when the scorer gave no reason at all", () => {
    const s = generateClubSignals(input({
      members: [member({ risk: "at_risk", daysSinceAttended: 5, reasons: [] })],
    }))[0]!;
    expect(s.summary).toContain("involvement has thinned out");
    expect(s.summary).not.toContain("undefined");
  });

  it("never raises a signal about someone on leave", () => {
    const s = generateClubSignals(input({
      members: [member({
        onLeave: true, risk: "at_risk", daysSinceAttended: 300, daysSinceTouch: 400,
      })],
    }));
    expect(s).toEqual([]);
  });

  it("separates 'drifting' from 'invisible' — a happy member can still be unseen", () => {
    // Attending regularly, but no one has logged a conversation in a year.
    // This is how a club gets surprised by a resignation.
    const s = generateClubSignals(input({
      members: [member({ risk: "steady", daysSinceAttended: 5, daysSinceTouch: 400 })],
    }));
    expect(kinds(s)).toEqual(["reconnect"]);
    expect(s[0]!.evidence.attending).toBe(true);
    expect(s[0]!.severity).toBe("info");
  });

  it("does not raise both at_risk and reconnect for the same person", () => {
    const s = generateClubSignals(input({
      members: [member({ risk: "at_risk", daysSinceAttended: 200, daysSinceTouch: 400 })],
    }));
    expect(kinds(s)).toEqual(["at_risk"]);
  });

  it("keeps reconnect gentle and low-priority — it is not an alarm", () => {
    const s = generateClubSignals(input({ members: [member({ daysSinceTouch: 400 })] }))[0]!;
    expect(s.severity).toBe("info");
    expect(s.suggestedAction).toMatch(/five minutes/i);
  });
});

describe("good news", () => {
  it("reports progress, so the list isn't only ever bad news", () => {
    const s = generateClubSignals(input({
      milestones: [{ kind: "members_gained", detail: "Three people joined this quarter.", value: 3 }],
    }));
    expect(kinds(s)).toContain("celebration");
    expect(s[0]!.title).toBe("3 new members this quarter");
  });

  it("marks a charter anniversary as a milestone", () => {
    const s = generateClubSignals(input({
      milestones: [{ kind: "charter_anniversary", detail: "The club turns 75 this week.", value: 75 }],
    }));
    expect(s[0]!.kind).toBe("milestone");
    expect(s[0]!.title).toBe("75 years since the club chartered");
  });

  it("survives a bad week alongside good news", () => {
    const s = generateClubSignals(input({
      members: [member({ risk: "at_risk", daysSinceAttended: 90 })],
      milestones: [{ kind: "attendance_recovered", detail: "Attendance is climbing.", value: 1 }],
    }));
    expect(kinds(s)).toContain("celebration");
    expect(kinds(s)).toContain("at_risk");
  });
});

describe("vacant offices", () => {
  it("lists them in one readable sentence", () => {
    const s = generateClubSignals(input({
      vacantOffices: ["Membership Chair", "Program Chair", "Public Image Chair"],
    }))[0]!;
    expect(s.summary).toBe("Nobody is currently assigned to Membership Chair, Program Chair and Public Image Chair.");
  });

  it("handles one and two offices without an awkward list", () => {
    expect(generateClubSignals(input({ vacantOffices: ["Club Treasurer"] }))[0]!.summary)
      .toBe("Nobody is currently assigned to Club Treasurer.");
    expect(generateClubSignals(input({ vacantOffices: ["Club Treasurer", "Club Secretary"] }))[0]!.summary)
      .toBe("Nobody is currently assigned to Club Treasurer and Club Secretary.");
  });
});

// ── Contract ──────────────────────────────────────────────────────────────────

describe("every signal", () => {
  const sample = generateClubSignals(input({
    members: [
      member({ personId: "pe_1", risk: "at_risk", daysSinceAttended: 90 }),
      member({ personId: "pe_2", name: "Quiet One", daysSinceTouch: 400 }),
      member({ personId: "pe_3", name: "Long Server", anniversaryYears: 25 }),
    ],
    guests: [guest()],
    overdueDues: [dues()],
    vacantOffices: ["Program Chair"],
    milestones: [{ kind: "project_completed", detail: "The park build finished.", value: 1 }],
    health: { score: 44, status: "at_risk", reasons: ["Attendance has dropped noticeably."] },
    healthLastWeek: { score: 66, status: "watch" },
  }));

  it("produced a representative spread to test against", () => {
    expect(sample.length).toBe(WEEKLY_SIGNAL_CAP);
  });

  it("carries evidence, so 'why am I seeing this?' always has an answer", () => {
    for (const s of sample) {
      expect(Object.keys(s.evidence).length, s.kind).toBeGreaterThan(0);
    }
  });

  it("carries one concrete action", () => {
    for (const s of sample) {
      expect(s.suggestedAction.length, s.kind).toBeGreaterThan(15);
      expect(s.suggestedAction, s.kind).toMatch(/[.!]$/);
    }
  });

  it("has a unique dedupe key scoped to the club and the week", () => {
    const keys = sample.map((s) => s.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(k).toContain("cl_1");
      expect(k).toContain("2026-08-03");
    }
  });

  it("is deterministic and stably ordered across runs", () => {
    const facts = input({
      members: [
        member({ personId: "pe_1", risk: "at_risk", daysSinceAttended: 90 }),
        member({ personId: "pe_2", name: "B", daysSinceTouch: 400 }),
      ],
      guests: [guest()],
    });
    const first = generateClubSignals(facts);
    for (let i = 0; i < 20; i++) expect(generateClubSignals(facts)).toEqual(first);
  });

  it("breaks priority ties stably, so the list doesn't reshuffle between page loads", () => {
    const tied: Signal[] = ["c", "a", "b"].map((k) => ({
      kind: "reconnect", severity: "info", clubId: "cl_1", personId: null,
      title: "t", summary: "s", suggestedAction: "a.", evidence: {}, dedupeKey: k, priority: 50,
    }));
    expect(rank(tied).map((s) => s.dedupeKey)).toEqual(["a", "b", "c"]);
  });

  it("writes titles and summaries in plain sentences", () => {
    for (const s of sample) {
      expect(s.title, s.kind).not.toMatch(/_/);
      expect(s.summary, s.kind).toMatch(/[.!]$/);
      expect(s.summary, s.kind).not.toMatch(/undefined|null|NaN/);
    }
  });

  it("never blames, scolds, or manufactures urgency in its copy", () => {
    for (const s of sample) {
      const text = `${s.title} ${s.summary} ${s.suggestedAction}`;
      expect(text, s.kind).not.toMatch(/\b(failed|neglect|must|should have|urgent|immediately|act now)\b/i);
    }
  });

  it("stays secular", () => {
    for (const s of sample) {
      const text = `${s.title} ${s.summary} ${s.suggestedAction}`;
      expect(text, s.kind).not.toMatch(/\b(blessed|shepherd|ministry|sacred|beautiful)\b/i);
    }
  });

  it("reserves 'urgent' for the one thing that is genuinely time-limited", () => {
    // A guest's interest has a window. Nothing else here does.
    for (const s of sample) {
      if (s.severity === "urgent") expect(s.kind).toBe("guest_follow_up");
    }
  });
});
