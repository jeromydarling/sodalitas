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
import { MEDIA, HOUSE_STYLE, promptFor, mediaSlot } from "./media";
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
    expect(mediaSlot("home-hero")?.aspect).toBe("16/9");
    expect(mediaSlot("nope")).toBeUndefined();
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

  it("keeps the set looking like one set", () => {
    expect(HOUSE_STYLE).toMatch(/natural.*light/i);
    expect(HOUSE_STYLE).toMatch(/documentary/i);
  });
});
