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
   * The three ways a prompt can put a room full of people on the page without
   * a face being rendered.
   *
   * Stated as alternatives rather than as one required technique, because the
   * first version of this test demanded motion blur specifically — and then
   * blocked the fix that finally worked. Motion blur is a post-condition the
   * model can decline to apply; three runs proved it. Backlighting is
   * physics: put the camera between the room and the windows and every figure
   * is a silhouette whether the model cooperates or not.
   */
  const FACE_PROOF = /motion blur|softened|mid-movement|blurred|silhouette|contre-jour|backlit|out of focus/i;

  it("makes faces unrenderable wherever people appear", () => {
    // This is the actual requirement. A face this model renders is a face
    // that looks generated, and — left to its own devices — it is also always
    // the same face: elderly, white, in a church hall, on the front page of a
    // product about clubs not dying.
    expect(peopled.length).toBeGreaterThan(2);
    for (const slot of peopled) {
      expect(slot.prompt, slot.key).toMatch(FACE_PROOF);
    }
  });

  it("says who is in the room wherever a face could still be read", () => {
    // Only where the technique leaves people legible enough to have an age.
    // A silhouette hasn't got one, which is most of why it's the better
    // answer — the instruction can't be ignored if there is nothing to
    // ignore it with.
    const legible = peopled.filter((m) => !/silhouette|contre-jour|backlit/i.test(m.prompt));
    const vague = legible
      .filter((m) => !/mixed[- ]age|thirties|mixed group/i.test(m.prompt))
      .map((m) => m.key);

    expect(vague, `these describe a group without saying who's in it: ${vague.join(", ")}`).toEqual(
      [],
    );
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
