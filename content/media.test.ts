/**
 * media.test.ts — the registry, and the two ways it silently rots.
 *
 * `usedOn` exists so an unused slot is obvious. It is hand-written prose, so
 * it went stale exactly as you'd expect: one slot claimed a route that had
 * never existed, and another was generated, committed and rendered nowhere at
 * all. Neither cost anything visible — which is why neither was noticed.
 *
 * Both are now checked against the source rather than against somebody's
 * memory. Generating an image nobody displays is a Cloudflare bill and a
 * repository full of binary, and it is the sort of thing that only ever gets
 * found when somebody goes looking.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MEDIA, HOUSE_STYLE, FILM, promptFor, mediaSlot } from "./media";
import { FEATURES } from "./features";

/** Every .tsx under app/, concatenated. Cheap enough at this size. */
function appSource(): string {
  const root = join(import.meta.dirname, "..", "app");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "media" && entry !== "fonts") walk(path);
      } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
        out.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(root);
  return out.join("\n");
}

describe("the registry", () => {
  it("has a unique key for every slot", () => {
    const keys = MEDIA.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("writes a prompt long enough to produce something specific", () => {
    for (const slot of MEDIA) {
      expect(slot.prompt.length, slot.key).toBeGreaterThan(60);
    }
  });

  it("appends the house style to every prompt", () => {
    for (const slot of MEDIA) {
      expect(promptFor(slot), slot.key).toContain(HOUSE_STYLE);
    }
  });

  it("looks a slot up by key", () => {
    expect(mediaSlot("home-hero")?.treatment).toBe("backdrop");
    expect(mediaSlot("nope")).toBeUndefined();
  });

  it("gives a backdrop a wide frame", () => {
    // A backdrop cropped from a 4:3 render is a portrait with its sides cut
    // off, and the composition the prompt asked for goes with them.
    for (const slot of MEDIA.filter((m) => m.treatment === "backdrop" || m.treatment === "band")) {
      expect(slot.aspect, slot.key).toBe("21/9");
    }
  });

  it("never gives a backdrop alt text", () => {
    // It sits at 18% behind a headline. There is nothing there to describe,
    // and a screen reader announcing it is noise.
    for (const slot of MEDIA.filter((m) => m.treatment === "backdrop")) {
      expect(slot.alt, slot.key).toBe("");
    }
  });

  it("folds the treatment into the prompt", () => {
    expect(promptFor(mediaSlot("home-hero")!)).toMatch(/composed as a background/i);
    expect(promptFor(mediaSlot("home-welcome")!)).toMatch(/close in on one subject/i);
  });
});

describe("every slot is actually shown somewhere", () => {
  const source = appSource();

  it("is referenced in a component or claimed by a feature", () => {
    // A slot reaches a page one of two ways: a route names it in <Media
    // slot="…">, or a feature declares it and feature-detail renders it.
    const claimedByFeature = new Set(FEATURES.map((f) => f.media).filter(Boolean));
    const orphans = MEDIA.filter(
      (m) => !source.includes(`"${m.key}"`) && !claimedByFeature.has(m.key),
    ).map((m) => m.key);

    expect(
      orphans,
      `these images get generated and rendered nowhere: ${orphans.join(", ")}`,
    ).toEqual([]);
  });
});

describe("usedOn tells the truth", () => {
  const routes = readFileSync(join(import.meta.dirname, "..", "app", "routes.ts"), "utf8");
  const featureSlugs = new Set(FEATURES.map((f) => f.slug));

  it("names a route that exists", () => {
    const wrong: string[] = [];
    for (const slot of MEDIA) {
      const path = slot.usedOn;
      // A feature detail page — the only parameterised route a slot uses.
      const feature = /^\/features\/(.+)$/.exec(path);
      if (feature) {
        if (!featureSlugs.has(feature[1]!)) wrong.push(`${slot.key} → ${path}`);
        continue;
      }
      if (path === "/") continue;
      // Everything else must appear as a literal route in routes.ts.
      if (!routes.includes(`"${path.replace(/^\//, "")}"`)) wrong.push(`${slot.key} → ${path}`);
    }
    expect(wrong, `usedOn points at routes that 404: ${wrong.join(", ")}`).toEqual([]);
  });

  it("matches the feature that actually declares the slot", () => {
    // The specific drift that happened: projects-spot said /features/projects,
    // there is no projects feature, and the slot is really the committees one.
    const mismatched: string[] = [];
    for (const feature of FEATURES) {
      if (!feature.media) continue;
      const slot = mediaSlot(feature.media);
      if (!slot) {
        mismatched.push(`${feature.slug} wants a slot that doesn't exist: ${feature.media}`);
        continue;
      }
      if (slot.usedOn !== `/features/${feature.slug}`) {
        mismatched.push(`${slot.key} says ${slot.usedOn}, but ${feature.slug} declares it`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});

describe("the house style", () => {
  it("rules out the two things that make a picture look generated", () => {
    // Faces and lettering, in that order. Both were produced on the first run
    // despite being forbidden, and both were fixed by describing the shot
    // rather than by forbidding harder.
    expect(HOUSE_STYLE).toMatch(/no text|no lettering/i);
    expect(HOUSE_STYLE).toMatch(/no letterboxing|no black bars/i);
  });

  it("names a film stock rather than describing a mood", () => {
    // "Natural light, muted colour" produced a clean digital render with the
    // saturation pulled down — which is what the first set looked like. A
    // named stock with grain and halation produces something that reads as
    // photographed, and the imperfection is most of the reason.
    expect(FILM).toMatch(/35mm/i);
    expect(FILM).toMatch(/portra/i);
    expect(FILM).toMatch(/grain/i);
    expect(FILM).toMatch(/halation/i);
    expect(HOUSE_STYLE).toContain(FILM);
  });
});

describe("the direction on people", () => {
  /** Prompts that put people in the frame, as opposed to ruling them out. */
  const peopled = MEDIA.filter(
    (m) =>
      /group|people|crowd|party/i.test(m.prompt) &&
      !/no people|nobody in frame|nobody anywhere/i.test(m.prompt),
  );

  /**
   * Words that ask for a crowd.
   *
   * This replaced a test that demanded motion blur, then silhouettes — both
   * of which were techniques for hiding a crowd rather than reasons to have
   * one. Crowds are the actual failure: these models render two people at a
   * table beautifully and thirty in a hall appallingly, and left to choose
   * they always choose the same thirty.
   */
  const CROWD = /\bcrowd|packed|dozens|twenty or thirty|thirty or forty|full of people|a room of people/i;

  it("never asks for a crowd", () => {
    const crowded = MEDIA.filter((m) => CROWD.test(m.prompt)).map((m) => m.key);
    expect(crowded, `these ask for a crowd: ${crowded.join(", ")}`).toEqual([]);
    expect(HOUSE_STYLE).toMatch(/at most three people/i);
  });

  it("says who the people are, since there are few enough to see", () => {
    // With two in frame it matters more, not less. Left unsaid the model
    // picks, and it picks the same way every time — which is how the first
    // set ended up illustrating a product about clubs not dying with a
    // photograph of a club that had.
    const vague = peopled
      .filter((m) => !/in (his|her|their) (twenties|thirties|forties|fifties|sixties|seventies)/i.test(m.prompt))
      .map((m) => m.key);

    expect(vague, `these show people without saying who: ${vague.join(", ")}`).toEqual([]);
  });

  it("leaves nobody in the frame undescribed", () => {
    // The specific hole the previous test had. "A man in his thirties
    // laughing, and two others listening" passes an age check and still
    // hands the model two blank slots — which it filled with two more white
    // men in overcoats. Anyone who appears has to be described.
    const PLACEHOLDER = /\b(two|three|a few|several|some) others?\b|\bthe others?\b|\banother person\b|\bothers listening\b/i;
    const lazy = MEDIA.filter((m) => PLACEHOLDER.test(m.prompt)).map((m) => m.key);

    expect(
      lazy,
      `these leave a person for the model to invent: ${lazy.join(", ")}`,
    ).toEqual([]);
  });

  it("does not let the homepage be a set of empty rooms", () => {
    // The actual failure, stated as an invariant. One wide shot of a hall
    // with nobody in it read as a club that had already died; four of them
    // would be worse. At least one homepage slot has to have a room full of
    // people in it.
    const home = MEDIA.filter((m) => m.usedOn === "/");
    expect(home.length).toBeGreaterThanOrEqual(3);
    expect(home.some((m) => peopled.includes(m))).toBe(true);
  });
});
