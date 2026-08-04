import { describe, it, expect } from "vitest";
import {
  parseHex,
  toHex,
  rgbToOklch,
  oklchToRgb,
  hexToOklch,
  oklchToHex,
  contrastRatio,
  textOn,
  buildRamp,
  buildNeutralRamp,
  RAMP_STEPS,
  validateTokens,
  parseTokens,
  tokensToStyle,
  auditTokens,
  DEFAULT_TOKENS,
  AA_NORMAL,
} from "./palette";
import {
  ROTARY_COLOURS,
  BRAND_PRESETS,
  nearestRotaryColour,
  paletteAdvice,
} from "@content/rotary";

describe("hex", () => {
  it("reads the forms people actually type", () => {
    expect(parseHex("#17458F")).toEqual(parseHex("17458f"));
    expect(parseHex("#fff")).toEqual(parseHex("#ffffff"));
    expect(parseHex("  #17458f  ")).not.toBeNull();
  });

  it("rejects anything else", () => {
    expect(parseHex("blue")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("#gggggg")).toBeNull();
    expect(parseHex(null)).toBeNull();
    expect(parseHex(0x17458f)).toBeNull();
  });

  it("round-trips", () => {
    expect(toHex(parseHex("#17458f")!)).toBe("#17458f");
  });
});

describe("OKLCH", () => {
  it("round-trips every Rotary colour to within a rounding step", () => {
    for (const colour of ROTARY_COLOURS) {
      const back = oklchToHex(hexToOklch(colour.hex)!);
      const a = parseHex(colour.hex)!;
      const b = parseHex(back)!;
      const drift = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
      expect(drift, `${colour.name} drifted`).toBeLessThan(1.5 / 255);
    }
  });

  it("puts white and black where they belong", () => {
    expect(rgbToOklch(parseHex("#ffffff")!).l).toBeCloseTo(1, 2);
    expect(rgbToOklch(parseHex("#000000")!).l).toBeCloseTo(0, 2);
  });

  it("agrees with the eye about lightness where HSL does not", () => {
    // The whole reason this file isn't HSL: these two claim the same lightness
    // in HSL and are wildly different to look at.
    const yellow = hexToOklch("#ffff00")!;
    const blue = hexToOklch("#0000ff")!;
    expect(yellow.l).toBeGreaterThan(blue.l + 0.4);
  });

  it("brings an impossible colour back into gamut without moving the hue", () => {
    // Far more chroma than sRGB can show at that lightness.
    const wild = { l: 0.6, c: 0.5, h: 250 };
    const rgb = oklchToRgb(wild);
    for (const v of [rgb.r, rgb.g, rgb.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const back = rgbToOklch(rgb);
    expect(Math.abs(back.h - 250)).toBeLessThan(2);
    expect(back.l).toBeCloseTo(0.6, 1);
  });
});

describe("contrast", () => {
  it("matches the values WCAG publishes", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 3);
    // The canonical example from the WCAG techniques.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.6);
  });

  it("picks text that can be read on the Rotary primaries", () => {
    // Royal Blue is a white-text colour; Gold is emphatically not.
    expect(textOn("#17458f")).toBe("#ffffff");
    expect(textOn("#f7a81b")).toBe("#1c1a17");
  });

  it("always picks the better of the two", () => {
    for (const colour of ROTARY_COLOURS) {
      const chosen = textOn(colour.hex);
      const other = chosen === "#ffffff" ? "#1c1a17" : "#ffffff";
      expect(contrastRatio(chosen, colour.hex)).toBeGreaterThanOrEqual(
        contrastRatio(other, colour.hex),
      );
    }
  });
});

describe("ramps", () => {
  it("gets lighter to darker, monotonically, for every Rotary colour", () => {
    for (const colour of ROTARY_COLOURS) {
      const ramp = buildRamp(colour.hex)!;
      const lightness = RAMP_STEPS.map((s) => hexToOklch(ramp[s])!.l);
      for (let i = 1; i < lightness.length; i++) {
        expect(lightness[i]!, `${colour.name} step ${RAMP_STEPS[i]}`).toBeLessThan(lightness[i - 1]!);
      }
    }
  });

  it("holds the hue across the whole ramp", () => {
    const ramp = buildRamp("#d41367")!;
    const hues = RAMP_STEPS.map((s) => hexToOklch(ramp[s])!.h);
    const spread = Math.max(...hues) - Math.min(...hues);
    expect(spread).toBeLessThan(6);
  });

  it("produces a 700 dark enough for body-sized links on white", () => {
    for (const colour of ROTARY_COLOURS) {
      const ramp = buildRamp(colour.hex)!;
      expect(contrastRatio(ramp[700], "#ffffff"), colour.name).toBeGreaterThan(AA_NORMAL);
    }
  });

  it("makes neutrals that carry the brand's hue but almost no colour", () => {
    const neutral = buildNeutralRamp("#d41367")!;
    for (const step of RAMP_STEPS) {
      expect(hexToOklch(neutral[step])!.c).toBeLessThan(0.025);
    }
    expect(contrastRatio(neutral[900], "#ffffff")).toBeGreaterThan(12);
  });

  it("survives a seed with no colour in it at all", () => {
    const ramp = buildRamp("#808080")!;
    expect(ramp[50]).toBeTruthy();
    expect(ramp[900]).toBeTruthy();
    expect(buildRamp("nonsense")).toBeNull();
  });
});

describe("tokens", () => {
  it("falls back rather than failing", () => {
    expect(validateTokens(null)).toEqual(DEFAULT_TOKENS);
    expect(validateTokens({ brandHex: "javascript:alert(1)" }).brandHex).toBe(DEFAULT_TOKENS.brandHex);
    expect(validateTokens({ fontPair: "comic" }).fontPair).toBe("rotary");
    expect(validateTokens({ radius: 9999 }).radius).toBe(24);
    expect(validateTokens({ radius: -5 }).radius).toBe(0);
    expect(validateTokens({ density: "spacious" }).density).toBe("regular");
    expect(parseTokens("{{{")).toEqual(DEFAULT_TOKENS);
  });

  it("normalises a hex a club typed without the hash", () => {
    expect(validateTokens({ brandHex: "17458F" }).brandHex).toBe("#17458f");
  });

  it("clamps the voice note rather than storing an essay", () => {
    const tokens = validateTokens({ voice: { note: "x".repeat(1000), warmth: 99 } });
    expect(tokens.voice.note.length).toBe(240);
    expect(tokens.voice.warmth).toBe(5);
  });

  it("emits custom properties, never a stylesheet string", () => {
    const style = tokensToStyle(DEFAULT_TOKENS);
    expect(style["--site-brand-600"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(style["--site-brand-solid"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(style["--site-on-brand"]).toBe("#ffffff");
    expect(style["--site-radius"]).toBe("10px");
    // Every value is a plain token — nothing here can close a declaration.
    for (const value of Object.values(style)) {
      expect(value).not.toContain(";");
      expect(value).not.toContain("}");
      expect(value).not.toContain("<");
    }
  });

  it("still emits usable properties when the stored hex is nonsense", () => {
    const style = tokensToStyle({ ...DEFAULT_TOKENS, brandHex: "not-a-colour" });
    expect(style["--site-brand-600"]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("auditTokens", () => {
  it("is quiet about the default Rotary pairing", () => {
    expect(auditTokens(DEFAULT_TOKENS)).toEqual([]);
  });

  it("warns when the two colours are indistinguishable", () => {
    const warnings = auditTokens({ ...DEFAULT_TOKENS, brandHex: "#17458f", accentHex: "#17468f" });
    expect(warnings.some((w) => w.where === "The two colours")).toBe(true);
  });

  it("stays quiet for a pale seed, because the ramp already fixed it", () => {
    // The point of normalising lightness in buildRamp: a club can hand us
    // butter-yellow and still get a legible site. If this ever starts warning,
    // the ramp shape regressed.
    expect(auditTokens({ ...DEFAULT_TOKENS, brandHex: "#ffe9a8" })).toEqual([]);
    expect(auditTokens({ ...DEFAULT_TOKENS, brandHex: "#0a0a0a" })).toEqual([]);
  });

  it("is quiet for every preset a club can pick", () => {
    for (const preset of BRAND_PRESETS) {
      const warnings = auditTokens({
        ...DEFAULT_TOKENS,
        brandHex: preset.brandHex,
        accentHex: preset.accentHex,
      });
      expect(warnings, `${preset.name}: ${warnings.map((w) => w.message).join(" ")}`).toEqual([]);
    }
  });

  it("writes warnings a club officer could act on", () => {
    const warnings = auditTokens({ ...DEFAULT_TOKENS, brandHex: "#17458f", accentHex: "#17468f" });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((w) => w.message.length > 20)).toBe(true);
  });
});

describe("staying inside the Rotary palette", () => {
  it("says nothing when a club is already on-palette", () => {
    expect(paletteAdvice("#17458f", "#f7a81b")).toBeNull();
    for (const preset of BRAND_PRESETS) {
      expect(paletteAdvice(preset.brandHex, preset.accentHex), preset.name).toBeNull();
    }
  });

  it("names the nearest Rotary colour when a club drifts off it", () => {
    // A club that pasted their old website's blue out of a stylesheet.
    const advice = paletteAdvice("#2b6cb0", "#f7a81b");
    expect(advice).toBeTruthy();
    expect(advice).toContain("Azure");
  });

  it("finds the nearest colour by eye, not by hex arithmetic", () => {
    expect(nearestRotaryColour("#18468e")!.colour.key).toBe("royal_blue");
    expect(nearestRotaryColour("#f9ab22")!.colour.key).toBe("gold");
    expect(nearestRotaryColour("not a colour")).toBeNull();
  });
});
