/**
 * spam.test.ts
 *
 * The two failure modes are opposite and both bad: turning away a real person
 * who wants to join a Rotary club, and letting the club's join inbox fill with
 * SEO pitches.
 *
 * The tests that matter most are the ones about *what the sender is told*.
 * Spam is accepted silently — same friendly answer, filed away — because
 * telling a bot which rule caught it teaches whoever wrote it what to change.
 */
import { describe, it, expect } from "vitest";
import { scoreSubmission, SPAM_THRESHOLD, type Submission } from "./spam";

const REAL: Submission = {
  name: "Marta Oyelaran",
  email: "marta.oyelaran@example.com",
  message:
    "I met one of your members at the food shelf last month and she suggested I come to a meeting. Are visitors welcome on Thursdays?",
  honeypot: "",
  elapsedMs: 45_000,
};

const sub = (over: Partial<Submission> = {}): Submission => ({ ...REAL, ...over });

describe("real people get through", () => {
  it("accepts a genuine enquiry", () => {
    const v = scoreSubmission(sub());
    expect(v.valid).toBe(true);
    expect(v.isSpam).toBe(false);
    expect(v.score).toBe(0);
  });

  it("accepts a short one", () => {
    const v = scoreSubmission(sub({ message: "Can I visit a meeting?" }));
    expect(v.isSpam).toBe(false);
  });

  it("accepts an empty message — the name and email are the point", () => {
    expect(scoreSubmission(sub({ message: "" })).isSpam).toBe(false);
  });

  it("accepts someone who mentions their own business", () => {
    // A Rotary club is full of business owners. Mentioning what you do is
    // normal here in a way it wouldn't be on most forms.
    const v = scoreSubmission(sub({
      message: "I run a web design company downtown and I'd like to get more involved locally. Could I come to a meeting?",
    }));
    expect(v.isSpam).toBe(false);
  });

  it("accepts one link from an otherwise normal person", () => {
    const v = scoreSubmission(sub({
      message: "My colleague suggested I get in touch — here's my LinkedIn: https://linkedin.com/in/example. Are guests welcome?",
    }));
    expect(v.isSpam).toBe(false);
  });

  it("accepts a long, heartfelt message", () => {
    const v = scoreSubmission(sub({
      message: `I've been thinking about joining a club for a while. ${"My father was a Rotarian and I remember the projects he worked on. ".repeat(20)}I'd love to visit.`,
    }));
    expect(v.isSpam).toBe(false);
  });
});

describe("spam is caught", () => {
  it("catches an SEO pitch", () => {
    const v = scoreSubmission(sub({
      name: "Digital Growth",
      email: "outreach@seo-agency.example",
      message:
        "Dear Sir/Madam, I am reaching out to offer SEO services and link building for your website. Increase your traffic today! https://a.example https://b.example https://c.example",
    }));
    expect(v.isSpam).toBe(true);
    expect(v.score).toBeGreaterThanOrEqual(SPAM_THRESHOLD);
  });

  it("catches a filled honeypot instantly", () => {
    const v = scoreSubmission(sub({ honeypot: "http://spam.example" }));
    expect(v.isSpam).toBe(true);
  });

  it("catches a form submitted faster than anyone could read it", () => {
    const v = scoreSubmission(sub({ elapsedMs: 400, message: "Check out https://x.example for cheap deals" }));
    expect(v.isSpam).toBe(true);
  });

  it("catches a look-alike sender domain", () => {
    const v = scoreSubmission(sub({
      email: "someone@gmial.com",
      message: "Investment opportunity — click here",
    }));
    expect(v.isSpam).toBe(true);
    expect(v.reasons.join(" ")).toMatch(/look-alike/);
  });

  it("catches a name that is really a URL", () => {
    const v = scoreSubmission(sub({
      name: "www.cheap-pills.example",
      message: "Discount code inside, limited offer",
    }));
    expect(v.isSpam).toBe(true);
  });

  it("catches a long blast that never mentions the club", () => {
    const v = scoreSubmission(sub({
      message: `We provide digital marketing at scale. ${"Our platform delivers measurable results for organisations worldwide. ".repeat(25)}`,
    }));
    expect(v.isSpam).toBe(true);
  });

  it("records why, for the club's review screen", () => {
    const v = scoreSubmission(sub({ honeypot: "x", elapsedMs: 100 }));
    expect(v.reasons.length).toBeGreaterThan(0);
    expect(v.reasons.join(" ")).toMatch(/hidden field/);
  });
});

// The behaviour the whole design rests on.
describe("what the sender is told", () => {
  it("never tells spam it was caught", () => {
    const spam = [
      sub({ honeypot: "x" }),
      sub({ elapsedMs: 200 }),
      sub({ name: "SEO Co", message: "link building and guest post services, click here now" }),
      sub({ email: "a@gmial.com", message: "crypto investment opportunity" }),
    ];
    for (const s of spam) {
      const v = scoreSubmission(s);
      // `valid: true` means the caller returns the same thank-you as a real
      // submission. The verdict is for the club, not the sender.
      expect(v.valid, JSON.stringify(s.message.slice(0, 30))).toBe(true);
      expect(v.message).toBeNull();
    }
  });

  it("does tell a real person about a real mistake", () => {
    const noName = scoreSubmission(sub({ name: "" }));
    expect(noName.valid).toBe(false);
    expect(noName.message).toMatch(/name and an email/i);

    const badEmail = scoreSubmission(sub({ email: "not-an-email" }));
    expect(badEmail.valid).toBe(false);
    expect(badEmail.message).toMatch(/doesn't look quite right/i);
  });

  it("does not hand a bot a diagnostic by validating its input", () => {
    // A bot with an empty name AND a filled honeypot gets the thank-you, not
    // "we need a name" — which would tell it exactly what to fix.
    const v = scoreSubmission(sub({ name: "", honeypot: "x" }));
    expect(v.valid).toBe(true);
    expect(v.isSpam).toBe(true);
  });

  it("keeps error copy kind and specific, never blaming", () => {
    for (const v of [scoreSubmission(sub({ name: "" })), scoreSubmission(sub({ email: "x" }))]) {
      expect(v.message).not.toMatch(/invalid|error|failed|required|must/i);
    }
  });
});

describe("scoring is deterministic", () => {
  it("gives the same submission the same verdict every time", () => {
    const s = sub({ message: "link building services, click here" });
    const first = scoreSubmission(s);
    for (let i = 0; i < 20; i++) expect(scoreSubmission(s)).toEqual(first);
  });

  it("does not mutate its input", () => {
    const s = sub();
    const snapshot = structuredClone(s);
    scoreSubmission(s);
    expect(s).toEqual(snapshot);
  });

  it("treats a zero elapsed time as unknown rather than instant", () => {
    // A form rendered before the timing script loaded reports 0. That is not
    // evidence of anything and must not push a real person over the line.
    expect(scoreSubmission(sub({ elapsedMs: 0 })).isSpam).toBe(false);
  });
});
