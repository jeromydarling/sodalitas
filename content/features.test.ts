/**
 * features.test.ts — the claims, and the rule that keeps them honest.
 *
 * The load-bearing test here is the one asserting every feature states a limit.
 * That field is required by the type, but a type can be satisfied with "None!"
 * — so the test checks it says something, and that it doesn't say it in a way
 * that quietly turns into another boast.
 */
import { describe, it, expect } from "vitest";
import { INCUMBENTS } from "@domain/pricing";
import { FEATURES, featureBySlug } from "./features";
import { LEGAL, legalBySlug } from "./legal";
import { VOICE } from "./brand";
import { Icon } from "~/brand";

const featureText = (f: (typeof FEATURES)[number]) =>
  [f.name, f.title, f.summary, ...f.body, ...f.does, f.limit].join(" ");

const legalText = (d: (typeof LEGAL)[number]) =>
  [d.title, d.summary, ...d.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.list ?? [])])].join(" ");

describe("the features registry", () => {
  it("has unique, URL-safe slugs", () => {
    const slugs = FEATURES.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s, s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("names an icon that actually exists", () => {
    // A typo here renders `undefined` as a component and takes the page down.
    for (const f of FEATURES) {
      expect(Icon[f.icon], `${f.slug} → ${f.icon}`).toBeTypeOf("function");
    }
  });

  it("finds one by slug and shrugs at an unknown", () => {
    expect(featureBySlug(FEATURES[0]!.slug)?.name).toBe(FEATURES[0]!.name);
    expect(featureBySlug("no-such-feature")).toBeUndefined();
  });

  it("gives each feature real substance", () => {
    for (const f of FEATURES) {
      expect(f.body.length, f.slug).toBeGreaterThanOrEqual(2);
      expect(f.does.length, f.slug).toBeGreaterThanOrEqual(3);
      expect(f.summary.length, f.slug).toBeGreaterThan(40);
    }
  });
});

describe("every feature admits a limit", () => {
  it("states one, at length", () => {
    // The whole reason the field is required. A club that discovers a limit
    // after paying tells the other clubs in its district.
    for (const f of FEATURES) {
      expect(f.limit.length, f.slug).toBeGreaterThan(50);
    }
  });

  it("doesn't dodge it", () => {
    // "Nothing!" and "coming soon" are ways of having a limit field without
    // having a limit.
    for (const f of FEATURES) {
      expect(f.limit, f.slug).not.toMatch(
        /^(none|nothing|n\/a)\b|\bcoming soon\b|\bwatch this space\b/i,
      );
    }
  });

  it("reads as a limitation rather than a boast", () => {
    // A "limit" phrased as "we're so focused we deliberately don't bloat it"
    // is marketing wearing a disclaimer's clothes.
    for (const f of FEATURES) {
      expect(f.limit, f.slug).not.toMatch(/\b(unlike|better than|superior)\b/i);
    }
  });

  it("names the alternatives somewhere, rather than talking around them", () => {
    const all = FEATURES.map(featureText).join(" ");
    expect(all).toMatch(/ClubRunner/);
    expect(all).toMatch(/Rotary International/);
  });
});

describe("voice, over features and legal alike", () => {
  const everything = [
    ...FEATURES.map((f) => ({ name: `feature:${f.slug}`, text: featureText(f) })),
    ...LEGAL.map((d) => ({ name: `legal:${d.slug}`, text: legalText(d) })),
  ];

  it("uses none of the banned vocabulary", () => {
    for (const { name, text } of everything) {
      const body = text.toLowerCase();
      for (const word of VOICE.banned) {
        expect(body.includes(word), `${name} contains "${word}"`).toBe(false);
      }
    }
  });

  it("makes no claim we can't back", () => {
    for (const { name, text } of everything) {
      const body = text.toLowerCase();
      for (const claim of VOICE.forbiddenClaims) {
        expect(body.includes(claim), `${name} claims "${claim}"`).toBe(false);
      }
    }
  });

  it("never tells a club it is failing", () => {
    for (const { name, text } of everything) {
      expect(text, name).not.toMatch(/your club is (failing|dying|in trouble)|if you don'?t act/i);
    }
  });
});

describe("the legal pages", () => {
  it("has unique, URL-safe slugs and resolves them", () => {
    const slugs = LEGAL.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s, s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(legalBySlug("privacy")?.title).toBe("Privacy");
    expect(legalBySlug("nope")).toBeUndefined();
  });

  it("covers the three a club's board will ask for", () => {
    const slugs = LEGAL.map((d) => d.slug);
    expect(slugs).toContain("privacy");
    expect(slugs).toContain("terms");
    expect(slugs).toContain("ai-transparency");
  });

  it("is dated", () => {
    for (const d of LEGAL) expect(d.updated, d.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("answers the question boards actually ask, in the privacy page", () => {
    const privacy = legalText(legalBySlug("privacy")!);
    // "Who can see our roster" is the whole conversation. A privacy page that
    // doesn't answer it directly has not been read by anyone who needed it.
    expect(privacy).toMatch(/roster/i);
    expect(privacy).toMatch(/district governor/i);
    expect(privacy).toMatch(/assistant governor/i);
  });

  it("states plainly that the retention score is not AI", () => {
    // The single most load-bearing claim in the product. If this page ever
    // stops saying it, something has gone wrong upstream in the code.
    const ai = legalText(legalBySlug("ai-transparency")!);
    expect(ai).toMatch(/not AI|never produces one|deterministic|fixed set of rules/i);
  });

  it("admits it hasn't been through a lawyer", () => {
    // True today. When it stops being true, delete this test in the same
    // commit as the review — not before.
    const all = LEGAL.map(legalText).join(" ");
    expect(all).toMatch(/not.*(reviewed|a substitute).*lawyer|lawyer/i);
  });
});

/**
 * Claims that go stale in opposite directions.
 *
 * When the website builder shipped, three places went out of date at once: the
 * feature's own limit ("it's one page, not a website builder"), the comparison
 * page's concession to ClubRunner, and the migration guide. Two of them read as
 * *modesty*, which is exactly the kind of wrong nobody reports — a club is not
 * going to email and say we undersold ourselves.
 *
 * So the honesty rule cuts both ways, and it is pinned here.
 */
describe("the website claim stays in step with the product", () => {
  const website = featureBySlug("public-page")!;

  it("no longer says we don't have a builder", () => {
    expect(website.limit).not.toMatch(/not a website builder/i);
    expect(website.limit).not.toMatch(/one page/i);
  });

  it("still states a real limit rather than none", () => {
    // The type requires a limit; a type cannot stop it becoming "None!".
    expect(website.limit.length).toBeGreaterThan(80);
    expect(website.limit).toMatch(/frustrat|restrict|not a blank canvas|keep whatever/i);
  });

  it("says the thing that is actually different about it", () => {
    // The live sections are the whole argument. If this claim ever leaves the
    // copy, the feature has been described as a generic page builder — which
    // is a fight we lose.
    const body = website.body.join(" ");
    expect(body).toMatch(/read your own records|fill(ing)? themselves in|nothing to update/i);
  });

  it("does not contradict the comparison page", () => {
    const clubrunner = INCUMBENTS.find((i) => i.key === "clubrunner")!;
    const conceded = clubrunner.betterAt.join(" ");
    // We may concede free-form layout. We may not concede having no builder.
    expect(conceded).not.toMatch(/more complete website builder/i);
    expect(conceded).toMatch(/free-form/i);
  });
});
