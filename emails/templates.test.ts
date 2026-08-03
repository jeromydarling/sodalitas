/**
 * templates.test.ts — the voice, enforced.
 *
 * These read like style rules; they aren't. Each one is a mistake this product
 * could plausibly make, and email is where making it costs most: a club that
 * feels nagged by its own software stops opening the tab, and a member who gets
 * a guilt-trip about attendance has been given a reason to leave rather than a
 * reason to come back.
 */
import { describe, it, expect } from "vitest";
import { ALL_TEMPLATES } from "./templates";
import { textToHtml } from "./send";
import { VOICE } from "@content/brand";

const templates = Object.entries(ALL_TEMPLATES).map(([name, build]) => ({ name, ...build() }));

describe("every template", () => {
  it("has a subject and a body", () => {
    for (const t of templates) {
      expect(t.subject.length, t.name).toBeGreaterThan(5);
      expect(t.text.length, t.name).toBeGreaterThan(40);
    }
  });

  it("leaves no placeholder unfilled", () => {
    for (const t of templates) {
      const body = `${t.subject} ${t.text}`;
      expect(body, t.name).not.toMatch(/undefined|null|NaN|\{\{|\}\}|\[object/);
    }
  });

  it("keeps subjects short enough to read in an inbox list", () => {
    for (const t of templates) expect(t.subject.length, t.name).toBeLessThanOrEqual(60);
  });

  it("never shouts in the subject line", () => {
    for (const t of templates) {
      expect(t.subject, t.name).not.toMatch(/!{2,}|[A-Z]{5,}/);
    }
  });
});

describe("voice", () => {
  it("uses none of the banned vocabulary", () => {
    for (const t of templates) {
      const body = `${t.subject} ${t.text}`.toLowerCase();
      for (const word of VOICE.banned) {
        expect(body.includes(word), `${t.name} contains "${word}"`).toBe(false);
      }
    }
  });

  it("makes no claim we can't back", () => {
    for (const t of templates) {
      const body = `${t.subject} ${t.text}`.toLowerCase();
      for (const claim of VOICE.forbiddenClaims) {
        expect(body.includes(claim), `${t.name} claims "${claim}"`).toBe(false);
      }
    }
  });

  it("never guilt-trips anyone about attendance", () => {
    for (const t of templates) {
      expect(t.text, t.name).not.toMatch(/we'?ve missed you|haven'?t seen you|you have not attended|absent/i);
    }
  });

  it("stays secular", () => {
    // CROS's voice was openly devotional. None of that belongs in a service
    // club's mail.
    for (const t of templates) {
      expect(t.text, t.name).not.toMatch(/\b(bless|pray|ministry|faithful|sacred|shepherd)\b/i);
    }
  });
});

describe("consent", () => {
  it("puts an unsubscribe on everything that isn't transactional", () => {
    for (const t of templates.filter((x) => !x.transactional)) {
      expect(t.text, t.name).toMatch(/unsubscribe|rather not/i);
      expect(t.text, t.name).toMatch(/https?:\/\//);
    }
  });

  it("does not put one on transactional mail, which would be a trap", () => {
    // Offering to unsubscribe someone from their own sign-in links is a way to
    // lock them out of an account they still want.
    for (const t of templates.filter((x) => x.transactional)) {
      expect(t.text, t.name).not.toMatch(/unsubscribe/i);
    }
  });

  it("treats sign-in and invitations as transactional", () => {
    const byName = Object.fromEntries(templates.map((t) => [t.name, t]));
    expect(byName.signInLink!.transactional).toBe(true);
    expect(byName.teamInvite!.transactional).toBe(true);
    expect(byName.receipt!.transactional).toBe(true);
    expect(byName.joinAcknowledgement!.transactional).toBe(true);
  });

  it("treats reminders and check-ins as marketing, because they are", () => {
    const byName = Object.fromEntries(templates.map((t) => [t.name, t]));
    expect(byName.meetingReminder!.transactional).toBe(false);
    expect(byName.checkIn!.transactional).toBe(false);
    expect(byName.duesReminder!.transactional).toBe(false);
    expect(byName.guestFollowUp!.transactional).toBe(false);
  });
});

describe("the ones that carry the most weight", () => {
  it("tells someone their sign-in link is single-use and short-lived", () => {
    const t = ALL_TEMPLATES.signInLink();
    expect(t.text).toMatch(/once/);
    expect(t.text).toMatch(/hour/);
    // And that ignoring an unrequested one is safe, which is the question
    // anybody receiving a surprise link actually has.
    expect(t.text).toMatch(/didn'?t ask for it/i);
  });

  it("asks a guest what they thought rather than whether they're joining", () => {
    const t = ALL_TEMPLATES.guestFollowUp();
    expect(t.text).toMatch(/what you made of it/i);
    expect(t.text).toMatch(/whether or not it'?s for you/i);
    expect(t.text).not.toMatch(/join|membership application|next step/i);
  });

  it("checks in on the person, not the register", () => {
    const t = ALL_TEMPLATES.checkIn();
    expect(t.subject).toBe("How are you?");
    expect(t.text).toMatch(/no agenda/i);
    expect(t.text).not.toMatch(/meeting|attendance/i);
  });

  it("tells someone behind on dues that the club would rather keep them", () => {
    const t = ALL_TEMPLATES.duesReminder();
    expect(t.text).toMatch(/rather keep you than the dues/i);
    expect(t.text).not.toMatch(/overdue|owing|arrears|failure to pay/i);
  });

  it("points a new club at the one thing worth doing first", () => {
    const t = ALL_TEMPLATES.welcomeAfterSignup();
    expect(t.text).toMatch(/roster/i);
    expect(t.text).toMatch(/import/);
    expect(t.text).toMatch(/undo it afterwards/i);
  });
});

describe("textToHtml", () => {
  it("escapes anything that could inject markup", () => {
    const html = textToHtml('Hello <script>alert("x")</script> & goodbye');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("links URLs without breaking on trailing punctuation", () => {
    expect(textToHtml("Go to https://example.test/x now")).toContain('href="https://example.test/x"');
  });

  it("turns blank lines into paragraphs", () => {
    const html = textToHtml("One.\n\nTwo.");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it("keeps single newlines as line breaks", () => {
    expect(textToHtml("One.\nTwo.")).toContain("<br>");
  });
});
