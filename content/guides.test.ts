/**
 * guides.test.ts — the voice and the honesty rules, over the guides.
 *
 * The email templates have been held to these since the beginning. Marketing
 * copy is where a voice actually slips — it is written to persuade, and the
 * words that persuade fastest are exactly the ones in VOICE.banned — so the
 * guides get the same treatment rather than the benefit of the doubt.
 */
import { describe, it, expect } from "vitest";
import { GUIDES, guideBySlug, readingMinutes } from "./guides";
import { VOICE, LEXICON } from "./brand";

const bodyOf = (g: (typeof GUIDES)[number]) =>
  [
    g.title,
    g.summary,
    g.audience,
    ...g.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.list ?? [])]),
  ].join(" ");

describe("the registry", () => {
  it("has guides", () => {
    expect(GUIDES.length).toBeGreaterThanOrEqual(4);
  });

  it("has unique slugs", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses URL-safe slugs", () => {
    for (const g of GUIDES) expect(g.slug, g.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("dates every guide, because an undated guide is untrustworthy", () => {
    for (const g of GUIDES) expect(g.updated, g.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("says who each one is for", () => {
    for (const g of GUIDES) expect(g.audience.length, g.slug).toBeGreaterThan(8);
  });

  it("gives every guide real substance rather than a stub", () => {
    // A thin guide is worse than no guide: it gets indexed, it gets linked,
    // and it teaches a reader the product is thinner than it is.
    for (const g of GUIDES) {
      expect(g.sections.length, g.slug).toBeGreaterThanOrEqual(3);
      expect(bodyOf(g).split(/\s+/).length, g.slug).toBeGreaterThan(400);
      for (const s of g.sections) {
        expect(s.paragraphs.length, `${g.slug} / ${s.heading}`).toBeGreaterThan(0);
      }
    }
  });

  it("summarises each one in a single sentence", () => {
    for (const g of GUIDES) {
      expect(g.summary.length, g.slug).toBeGreaterThan(40);
      expect(g.summary.length, g.slug).toBeLessThan(240);
    }
  });

  it("finds a guide by slug and shrugs at an unknown one", () => {
    expect(guideBySlug(GUIDES[0]!.slug)?.title).toBe(GUIDES[0]!.title);
    expect(guideBySlug("no-such-guide")).toBeUndefined();
  });

  it("estimates a sane reading time", () => {
    for (const g of GUIDES) {
      const m = readingMinutes(g);
      expect(m, g.slug).toBeGreaterThanOrEqual(1);
      expect(m, g.slug).toBeLessThan(30);
    }
  });
});

describe("voice", () => {
  it("uses none of the banned vocabulary", () => {
    for (const g of GUIDES) {
      const body = bodyOf(g).toLowerCase();
      for (const word of VOICE.banned) {
        expect(body.includes(word), `${g.slug} contains "${word}"`).toBe(false);
      }
    }
  });

  it("makes no claim we can't back", () => {
    for (const g of GUIDES) {
      const body = bodyOf(g).toLowerCase();
      for (const claim of VOICE.forbiddenClaims) {
        expect(body.includes(claim), `${g.slug} claims "${claim}"`).toBe(false);
      }
    }
  });

  it("never tells a club it is failing", () => {
    for (const g of GUIDES) {
      expect(bodyOf(g), g.slug).not.toMatch(
        /your club is (failing|dying|in trouble)|you are losing|if you don'?t act/i,
      );
    }
  });

  it("uses Rotary's own words for people", () => {
    // "prospective member" is not "lead". Getting this wrong in front of a
    // membership chair tells them the software was built for somebody else.
    for (const g of GUIDES) {
      const body = bodyOf(g).toLowerCase();
      for (const word of LEXICON.avoid) {
        // Word-boundary matched: "contacted" and "recorded" are ordinary
        // English, whereas "a contact" and "a record" are CRM-speak.
        const asNoun = new RegExp(`\\b(a|an|the|our|your|their|these|those|\\d+) ${word}s?\\b`);
        expect(asNoun.test(body), `${g.slug} uses "${word}" as a noun for a person`).toBe(false);
      }
    }
  });
});

describe("honesty", () => {
  it("includes at least one guide that argues against us", () => {
    // A guides section where every page concludes "so buy our thing" is an
    // advertisement wearing a guide's clothes, and readers can tell.
    const concedes = GUIDES.filter((g) =>
      /reasons not to|wrong answer|stay where you are|isn'?t worth|we do not|does not do it yet|not\b.*\bmove/i.test(
        bodyOf(g),
      ),
    );
    expect(concedes.length).toBeGreaterThan(0);
  });

  it("names the alternatives rather than talking around them", () => {
    const all = GUIDES.map(bodyOf).join(" ");
    expect(all).toMatch(/ClubRunner/);
    expect(all).toMatch(/DACdb/);
  });
});
