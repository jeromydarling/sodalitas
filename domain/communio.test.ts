/**
 * communio.test.ts
 *
 * The sanitiser is a privacy boundary, so the tests are adversarial: they try
 * to get a member's name, email, phone number or address across it, from every
 * direction — in the summary, buried in metadata, split across a nested array.
 *
 * The suite also pins the opposite failure. CROS's version had no allowlist, so
 * "Rotary International" and "Service Above Self" read as personal names and
 * burned the redaction budget on ordinary sentences. A sanitiser that blocks
 * everything looks identical to a feature nobody uses.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeSignal, scrub, findForbidden, buildActivityPulse, weekStartOf, scanGroup,
  MAX_SUMMARY_CHARS, REDACTION_BUDGET, MIN_COHORT, SHAREABLE_TYPES,
  DOMINANCE_THRESHOLD, type GroupActivity,
} from "./communio";

const ctx = { weekStart: "2026-08-03", cohortSize: 8 };
const ok = (summary: string, signalType = "attendance_trend", metadata?: Record<string, unknown>) =>
  sanitizeSignal({ signalType, summary, metadata }, ctx);

// ── The things that must never get out ────────────────────────────────────────

describe("personal data cannot cross the boundary", () => {
  // A contact identifier rejects outright rather than being redacted. Nobody
  // types an email into a group post by accident — its presence means the
  // sentence is about reaching a person, and a redacted version says nothing.
  it("rejects a summary containing an email address outright", () => {
    const r = ok("Reach our chair at president@rotaryduluth.org for details.");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("forbidden_value");
      expect(r.detail).toMatch(/email/i);
      expect(r.detail).toMatch(/not how to reach someone/i);
    }
  });

  it("rejects a phone number in any common format", () => {
    for (const phone of ["218-555-0134", "(218) 555-0134", "218.555.0134", "+1 218 555 0134"]) {
      const scrubbed = scrub(`Call ${phone} to book.`);
      expect(scrubbed.text, phone).not.toContain("555");
      expect(scrubbed.hardHits, phone).toContain("phone");
      expect(ok(`Call ${phone} to book.`).ok, phone).toBe(false);
    }
  });

  it("rejects a street address outright", () => {
    expect(ok("We moved to 421 Superior Street this month.").ok).toBe(false);
  });

  it("still only redacts the softer details, so the aggregate survives", () => {
    // Money and a link are lifted out; what happened is still shareable.
    const r = ok("Our gala raised $14,250 for the food shelf.", "fundraising_result");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.signal.summary).not.toContain("14,250");
      expect(r.signal.summary).toMatch(/gala raised .* for the food shelf/);
    }
  });

  it("blocks a member's name", () => {
    const { text, hits } = scrub("Margaret Chen brought three guests this month.");
    expect(text).not.toContain("Margaret");
    expect(text).not.toContain("Chen");
    expect(hits).toContain("name");
  });

  it("blocks dollar amounts", () => {
    const { text } = scrub("We raised $14,250 at the gala.");
    expect(text).not.toContain("14,250");
  });

  it("blocks street addresses and postal codes from the text either way", () => {
    const { text } = scrub("We meet at 421 Superior Street, 55802.");
    expect(text).not.toContain("421 Superior Street");
    expect(text).not.toContain("55802");
  });

  it("blocks URLs, which leak a club's identity even when the text doesn't", () => {
    const { text } = scrub("Details at https://rotaryduluth.org/join");
    expect(text).not.toContain("rotaryduluth");
  });

  it("refuses a payload with an identity-bearing field, without trying to clean it", () => {
    const r = ok("Attendance is recovering.", "attendance_trend", {
      count: 12,
      member_id: "pe_123",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("forbidden_key");
      expect(r.detail).toMatch(/member_id/);
    }
  });

  it("finds an identity field however deeply it is buried", () => {
    expect(findForbidden({ stats: { top: [{ email: "a@b.com" }] } })).toMatch(/email/);
    expect(findForbidden({ a: { b: { c: { last_name: "Chen" } } } })).toMatch(/last_name/);
    expect(findForbidden({ list: [1, 2, { notes: "private" }] })).toMatch(/notes/);
  });

  it("finds an identifying value even under a harmless-looking key", () => {
    expect(findForbidden({ detail: "ping president@club.org" })).toMatch(/email/);
    expect(findForbidden({ note: "call 218-555-0134" })).toMatch(/phone/);
  });

  it("passes a payload of plain counts", () => {
    expect(findForbidden({ attended: 34, invited: 40, week: "2026-08-03" })).toBeNull();
    expect(findForbidden({})).toBeNull();
    expect(findForbidden(null)).toBeNull();
  });

  it("drops a summary that needed too much redaction to trust", () => {
    const r = ok("Margaret Chen and David Olsen and Sarah Whitfield all brought guests.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_many_redactions");
  });

  it("allows a summary within the redaction budget", () => {
    const r = ok("Our incoming chair Margaret Chen reports attendance is climbing.");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.signal.summary).not.toContain("Margaret");
      expect(r.redactions).toBeLessThanOrEqual(REDACTION_BUDGET);
    }
  });
});

// ── The opposite failure: blocking everything ─────────────────────────────────

describe("ordinary Rotary language gets through", () => {
  const plain = [
    "Attendance is up ten points since the spring.",
    "Our Service Project wrapped up with 40 volunteers.",
    "Rotary International recognised the club this quarter.",
    "Three guests visited under the Four Way Test theme.",
    "The Rotary Foundation grant closed successfully.",
    "Our District Governor visited and attendance doubled.",
    "A Paul Harris Fellow recognition went out this week.",
    "Membership Chair reports five people in conversation.",
    "Community Service hours are at a five-year high.",
    "End Polio fundraising beat last year's total.",
    "Youth Exchange applications opened and interest is strong.",
    "Vocational Service talks have been the best-attended programs.",
  ];

  it("shares every one of these unchanged", () => {
    for (const summary of plain) {
      const r = ok(summary);
      expect(r.ok, summary).toBe(true);
      if (r.ok) expect(r.signal.summary, summary).toBe(summary);
    }
  });

  it("spends no redaction budget on Rotary vocabulary", () => {
    for (const summary of plain) {
      expect(scrub(summary).redactions, summary).toBe(0);
    }
  });

  it("still catches a real name sitting next to allowlisted vocabulary", () => {
    const { text } = scrub("Rotary International honoured Margaret Chen this year.");
    expect(text).toContain("Rotary International");
    expect(text).not.toContain("Margaret");
  });
});

// ── Cohort size ───────────────────────────────────────────────────────────────

describe("small groups can't anonymise", () => {
  it("refuses to share below the minimum cohort", () => {
    for (const cohortSize of [0, 1, 2]) {
      const r = sanitizeSignal(
        { signalType: "attendance_trend", summary: "Attendance is up." },
        { weekStart: "2026-08-03", cohortSize },
      );
      expect(r.ok, `cohort ${cohortSize}`).toBe(false);
      if (!r.ok) expect(r.reason).toBe("cohort_too_small");
    }
  });

  it("shares once the group is big enough to hide in", () => {
    const r = sanitizeSignal(
      { signalType: "attendance_trend", summary: "Attendance is up." },
      { weekStart: "2026-08-03", cohortSize: MIN_COHORT },
    );
    expect(r.ok).toBe(true);
  });

  it("explains the wait rather than failing silently", () => {
    const r = sanitizeSignal(
      { signalType: "attendance_trend", summary: "Attendance is up." },
      { weekStart: "2026-08-03", cohortSize: 2 },
    );
    if (!r.ok) expect(r.detail).toMatch(/once \d+ clubs have joined/i);
  });
});

// ── Shape ─────────────────────────────────────────────────────────────────────

describe("shape rules", () => {
  it("only accepts allowlisted signal types", () => {
    expect(ok("Fine.", "member_roster").ok).toBe(false);
    expect(ok("Fine.", "attendance_trend").ok).toBe(true);
  });

  it("keeps the allowlist to club-level facts, never individual-level ones", () => {
    // `membership_trend` is fine — it's a count. `member_profile` would not be.
    // Pinned as an exact set so widening it is a deliberate, reviewed act.
    expect([...SHAREABLE_TYPES].sort()).toEqual([
      "attendance_trend",
      "club_milestone",
      "event_invitation",
      "fundraising_result",
      "guest_activity",
      "membership_trend",
      "project_completed",
      "project_started",
      "retention_win",
      "speaker_recommendation",
    ]);
  });

  it("truncates a long summary to the cap", () => {
    const r = ok(`Attendance is climbing steadily this quarter. ${"and more detail ".repeat(40)}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.signal.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
      expect(r.signal.summary.endsWith("…")).toBe(true);
    }
  });

  it("rejects an empty summary", () => {
    expect(ok("").ok).toBe(false);
    expect(ok("   ").ok).toBe(false);
  });

  it("stamps the week rather than the moment", () => {
    const r = ok("Attendance is up.");
    if (r.ok) expect(r.signal.weekStart).toBe("2026-08-03");
  });
});

describe("weekStartOf", () => {
  it("returns the Monday of that week", () => {
    expect(weekStartOf("2026-08-03")).toBe("2026-08-03"); // a Monday
    expect(weekStartOf("2026-08-05")).toBe("2026-08-03"); // Wednesday
    expect(weekStartOf("2026-08-09")).toBe("2026-08-03"); // Sunday belongs to the week before
    expect(weekStartOf("2026-08-10")).toBe("2026-08-10"); // next Monday
  });

  it("accepts a full timestamp", () => {
    expect(weekStartOf("2026-08-05T13:47:02.000Z")).toBe("2026-08-03");
  });

  it("collapses a whole week to one bucket, so posting time isn't a fingerprint", () => {
    const days = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];
    expect(new Set(days.map(weekStartOf)).size).toBe(1);
  });
});

// ── Aggregates ────────────────────────────────────────────────────────────────

describe("activity pulse", () => {
  it("builds a countable sentence with nobody in it", () => {
    const s = buildActivityPulse({ projectsActive: 3, peopleServed: 120, volunteerHours: 48, guestsHosted: 5 });
    expect(s).not.toBeNull();
    expect(s!.summary).toBe("3 service projects underway, 120 people served, 48 volunteer hours, 5 guests hosted this week.");
    expect(sanitizeSignal(s!, ctx).ok).toBe(true);
  });

  it("omits the parts that are zero rather than reporting them", () => {
    const s = buildActivityPulse({ projectsActive: 1, peopleServed: 0, volunteerHours: 0, guestsHosted: 2 });
    expect(s!.summary).toBe("1 service project underway, 2 guests hosted this week.");
  });

  it("returns nothing for a quiet week rather than an empty boast", () => {
    expect(buildActivityPulse({ projectsActive: 0, peopleServed: 0, volunteerHours: 0, guestsHosted: 0 })).toBeNull();
  });
});

// ── Governance ────────────────────────────────────────────────────────────────

describe("group governance", () => {
  const activity = (over: Partial<GroupActivity> = {}): GroupActivity => ({
    groupId: "gr_1",
    cohortSize: 8,
    sharesByTenant: { tn_a: 4, tn_b: 3, tn_c: 5 },
    rejectionsByTenant: {},
    ...over,
  });

  it("says nothing about a healthy group", () => {
    expect(scanGroup(activity())).toEqual([]);
  });

  it("flags a group being used as a broadcast channel", () => {
    const flags = scanGroup(activity({ cohortSize: 4, sharesByTenant: { tn_a: 200 } }));
    expect(flags.map((f) => f.flagType)).toContain("excessive_sharing");
  });

  it("flags one club dominating the conversation", () => {
    const flags = scanGroup(activity({ sharesByTenant: { tn_a: 40, tn_b: 1, tn_c: 1 } }));
    const dom = flags.find((f) => f.flagType === "single_source");
    expect(dom).toBeDefined();
    expect(dom!.tenantId).toBe("tn_a");
    expect(dom!.details).toMatch(/stops being shared/);
  });

  it("does not call a two-post week domination", () => {
    // 1 of 1 is 100% and means nothing. A ratio needs volume behind it.
    const flags = scanGroup(activity({ sharesByTenant: { tn_a: 1, tn_b: 0 } }));
    expect(flags.map((f) => f.flagType)).not.toContain("single_source");
  });

  it("flags a club whose shares keep getting blocked", () => {
    const flags = scanGroup(activity({
      sharesByTenant: { tn_a: 2, tn_b: 3, tn_c: 5 },
      rejectionsByTenant: { tn_a: 9 },
    }));
    const spike = flags.find((f) => f.flagType === "rejection_spike");
    expect(spike).toBeDefined();
    expect(spike!.severity).toBe("high");
    expect(spike!.tenantId).toBe("tn_a");
  });

  it("ignores a couple of blocked shares", () => {
    const flags = scanGroup(activity({ rejectionsByTenant: { tn_a: 2 } }));
    expect(flags.map((f) => f.flagType)).not.toContain("rejection_spike");
  });

  it("surfaces a group nobody uses, gently", () => {
    const flags = scanGroup(activity({ sharesByTenant: {}, rejectionsByTenant: {} }));
    const silent = flags.find((f) => f.flagType === "silent_group");
    expect(silent).toBeDefined();
    expect(silent!.severity).toBe("low");
  });

  it("writes flags for a human reader, not a log parser", () => {
    const all = [
      ...scanGroup(activity({ cohortSize: 4, sharesByTenant: { tn_a: 200 } })),
      ...scanGroup(activity({ sharesByTenant: { tn_a: 40, tn_b: 1, tn_c: 1 } })),
      ...scanGroup(activity({ sharesByTenant: { tn_a: 2 }, rejectionsByTenant: { tn_a: 9 } })),
      ...scanGroup(activity({ sharesByTenant: {} })),
    ];
    for (const f of all) {
      expect(f.details, f.flagType).toMatch(/[.!]$/);
      expect(f.details, f.flagType).not.toMatch(/_id\b|null|undefined/);
    }
  });

  it("keeps the dominance threshold demanding enough to mean something", () => {
    expect(DOMINANCE_THRESHOLD).toBeGreaterThanOrEqual(0.75);
  });
});
