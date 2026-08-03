/**
 * prompts.test.ts
 *
 * A prompt is product copy that happens to be read by a model, and it drifts
 * the same way copy drifts. These pin the constraints that stop a draft
 * embarrassing a club in front of one of its own members.
 */
import { describe, it, expect } from "vitest";
import { ALL_PROMPTS } from "./prompts";
import { PROMPT_VERSION, isConfigured, NOT_CONFIGURED, draft } from "./provider";

const prompts = Object.entries(ALL_PROMPTS).map(([name, build]) => ({ name, ...build() }));

describe("every prompt", () => {
  it("carries the current version, so an invocation can be traced back", () => {
    for (const p of prompts) expect(p.version, p.name).toBe(PROMPT_VERSION);
  });

  it("forbids inventing a fact, and says what to do instead", () => {
    for (const p of prompts) {
      expect(p.system, p.name).toMatch(/never invent a fact/i);
      // A rule with no alternative gets ignored; the blank is the alternative.
      expect(p.system, p.name).toMatch(/\[ \]/);
    }
  });

  it("forbids signing a name or claiming to be anyone", () => {
    for (const p of prompts) expect(p.system, p.name).toMatch(/never sign a name/i);
  });

  it("rules out urgency, guilt and marketing language", () => {
    for (const p of prompts) {
      expect(p.system, p.name).toMatch(/no urgency, no guilt/i);
      expect(p.system, p.name).toMatch(/let the club down/i);
    }
  });

  it("keeps it secular", () => {
    for (const p of prompts) expect(p.system, p.name).toMatch(/secular/i);
  });

  it("makes clear the model is drafting, not sending", () => {
    for (const p of prompts) {
      expect(p.system, p.name).toMatch(/not sending anything/i);
    }
  });

  it("leaves no placeholder in the user message", () => {
    for (const p of prompts) {
      expect(p.user, p.name).not.toMatch(/undefined|null|\[object/);
    }
  });
});

describe("the constraints that matter most", () => {
  it("stops a guest follow-up turning into a membership pitch", () => {
    // A first note that pitches membership is why guests don't come back.
    const p = ALL_PROMPTS.guestFollowUp();
    expect(p.system).toMatch(/do not ask them to join/i);
    expect(p.system).toMatch(/do not mention membership/i);
    expect(p.system).toMatch(/why guests do not come back/i);
  });

  it("stops a check-in reading as a register being taken", () => {
    const p = ALL_PROMPTS.checkIn();
    expect(p.system).toMatch(/do NOT mention attendance/);
    expect(p.system).toMatch(/we'?ve missed you/i);
    expect(p.system).toMatch(/register being taken/i);
  });

  it("keeps context for the officer out of the member's note", () => {
    const p = ALL_PROMPTS.checkIn();
    expect(p.user).toMatch(/do not repeat it/i);
  });

  it("makes a recap use the real attendance figures", () => {
    const p = ALL_PROMPTS.meetingRecap();
    expect(p.system).toMatch(/exactly as given/i);
    expect(p.user).toContain("Members present: 31");
    expect(p.user).toContain("Guests: 2");
  });

  it("forbids the recap padding out a thin meeting", () => {
    const p = ALL_PROMPTS.meetingRecap();
    expect(p.system).toMatch(/rather than padding/i);
  });

  // The one place AI comes near a score, and it may only read.
  it("forbids the explainer from adding to or arguing with the numbers", () => {
    const p = ALL_PROMPTS.riskExplanation();
    expect(p.system).toMatch(/do not add factors/i);
    expect(p.system).toMatch(/do not disagree with the numbers/i);
    expect(p.system).toMatch(/describing a calculation, not making a judgement/i);
  });

  it("keeps the explainer on the relationship, not the person's character", () => {
    const p = ALL_PROMPTS.riskExplanation();
    expect(p.system).toMatch(/never about their character/i);
    expect(p.system).toMatch(/do not speculate/i);
  });
});

describe("degrading without a key", () => {
  it("reports not-configured when neither provider is present", () => {
    expect(isConfigured({})).toBe(false);
    expect(isConfigured({ ANTHROPIC_API_KEY: "sk-x" })).toBe(true);
    expect(isConfigured({ AI: { run: async () => ({}) } })).toBe(true);
  });

  it("returns a friendly line rather than an error", async () => {
    const r = await draft(
      {},
      null,
      { feature: "meeting_recap", system: "s", user: "u" },
      "2026-08-03T00:00:00.000Z",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.configured).toBe(false);
      expect(r.message).toBe(NOT_CONFIGURED);
    }
  });

  it("says the rest of the product still works", () => {
    // The message somebody reads when they press a button that isn't switched
    // on. It should not read like a fault.
    expect(NOT_CONFIGURED).toMatch(/everything else works/i);
    expect(NOT_CONFIGURED).not.toMatch(/error|failed|unavailable|cannot/i);
  });

  it("does not leak a provider error to a club officer", async () => {
    const r = await draft(
      { ANTHROPIC_API_KEY: "sk-invalid", AI: undefined },
      null,
      { feature: "meeting_recap", system: "s", user: "u" },
      "2026-08-03T00:00:00.000Z",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.configured).toBe(true);
      // A club officer can do nothing with an HTTP status, and it reads as
      // though the product is broken when it isn't.
      expect(r.message).not.toMatch(/\d{3}|anthropic|api|token/i);
      expect(r.message).toMatch(/try again in a moment/i);
    }
  });
});
