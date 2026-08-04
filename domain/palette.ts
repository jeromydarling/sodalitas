/**
 * palette.ts — colour, as arithmetic rather than as taste.
 *
 * A club picks one colour. From it we derive a nine-step ramp, decide what text
 * can legibly sit on each step, and refuse the combinations that fail WCAG. The
 * whole point is that a club officer with no design training cannot produce an
 * illegible site, and a language model proposing a palette cannot either — both
 * of them hand over a seed colour and this file does the rest.
 *
 * The maths is OKLCH, not HSL. HSL's "lightness" is a lie: `hsl(60 100% 50%)`
 * (yellow) and `hsl(240 100% 50%)` (blue) claim the same lightness and differ
 * by a factor of about twelve in perceived brightness. A ramp built on HSL
 * therefore has a step that reads as white in the yellows and as near-black in
 * the blues, which is precisely the failure this exists to prevent.
 *
 * Everything here is pure. No DOM, no colour library — a colour library is
 * 40KB to do six matrix multiplications.
 */

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma. 0 is grey; ~0.37 is about as saturated as sRGB gets. */
  c: number;
  /** Hue angle in degrees, 0–360. */
  h: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// ── Hex ───────────────────────────────────────────────────────────────────────

/** Parse `#abc`, `#aabbcc`, or the same without the hash. Null if it isn't one. */
export function parseHex(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  let s = input.trim().replace(/^#/, "").toLowerCase();
  if (s.length === 3) s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return {
    r: Number.parseInt(s.slice(0, 2), 16) / 255,
    g: Number.parseInt(s.slice(2, 4), 16) / 255,
    b: Number.parseInt(s.slice(4, 6), 16) / 255,
  };
}

const channel = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");

export function toHex({ r, g, b }: Rgb): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

// ── sRGB ↔ OKLCH ──────────────────────────────────────────────────────────────

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToRgbUnclamped({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);

  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;

  return {
    r: fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

const inGamut = ({ r, g, b }: Rgb) =>
  r >= -0.0001 && r <= 1.0001 && g >= -0.0001 && g <= 1.0001 && b >= -0.0001 && b <= 1.0001;

/**
 * OKLCH → sRGB, bringing out-of-gamut colours back in by *reducing chroma*
 * rather than by clipping channels.
 *
 * Clipping is what naive conversions do, and it shifts hue: clip the red
 * channel on a vivid orange and it comes back yellow. Binary-searching the
 * chroma keeps the hue and the lightness — the two things a club would notice —
 * and gives up only the saturation the display cannot show anyway.
 */
export function oklchToRgb(colour: Oklch): Rgb {
  const direct = oklchToRgbUnclamped(colour);
  if (inGamut(direct)) return direct;

  let lo = 0;
  let hi = colour.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgbUnclamped({ ...colour, c: mid }))) lo = mid;
    else hi = mid;
  }
  const out = oklchToRgbUnclamped({ ...colour, c: lo });
  return {
    r: Math.min(1, Math.max(0, out.r)),
    g: Math.min(1, Math.max(0, out.g)),
    b: Math.min(1, Math.max(0, out.b)),
  };
}

export const hexToOklch = (hex: string): Oklch | null => {
  const rgb = parseHex(hex);
  return rgb ? rgbToOklch(rgb) : null;
};

export const oklchToHex = (c: Oklch): string => toHex(oklchToRgb(c));

/** CSS, for the custom properties a rendered page carries. */
export function oklchCss({ l, c, h }: Oklch): string {
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`;
}

// ── Contrast ──────────────────────────────────────────────────────────────────

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

/**
 * How different two colours look, in OKLab units.
 *
 * Emphatically not `contrastRatio`. Contrast measures *luminance*, which is
 * what legibility depends on and has nothing to do with whether two colours
 * are distinguishable: Rotary Royal Blue and Rotary Violet are 1.1:1 in
 * contrast and could not be mistaken for one another by anybody. Asking
 * "can I read text on this" and "do these read as two colours" are different
 * questions and they need different functions.
 *
 * Roughly: below 0.03 is the same colour, 0.05 is a noticeable difference,
 * above 0.15 is clearly two colours.
 */
export function perceptualDistance(a: string, b: string): number {
  const ca = hexToOklch(a);
  const cb = hexToOklch(b);
  if (!ca || !cb) return 0;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const da = ca.c * Math.cos(rad(ca.h)) - cb.c * Math.cos(rad(cb.h));
  const db = ca.c * Math.sin(rad(ca.h)) - cb.c * Math.sin(rad(cb.h));
  const dl = ca.l - cb.l;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** White or near-black, whichever a visitor can actually read on this colour. */
export function textOn(background: string, dark = "#1c1a17", light = "#ffffff"): string {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

/** The contrast of the better of the two text colours on this background. */
export function bestContrast(background: string): number {
  return Math.max(contrastRatio(background, "#1c1a17"), contrastRatio(background, "#ffffff"));
}

// ── Ramps ─────────────────────────────────────────────────────────────────────

export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type RampStep = (typeof RAMP_STEPS)[number];
export type Ramp = Record<RampStep, string>;

/**
 * Target lightness per step, and how much of the seed's chroma each one keeps.
 *
 * Chroma peaks in the middle and falls away at both ends because that is what
 * real ink does: a pale tint is nearly white and a deep shade is nearly black,
 * and forcing full saturation into either produces the neon-highlighter effect
 * that makes an amateur site legible from space.
 */
const RAMP_SHAPE: Record<RampStep, { l: number; c: number }> = {
  50: { l: 0.975, c: 0.16 },
  100: { l: 0.945, c: 0.3 },
  200: { l: 0.895, c: 0.5 },
  300: { l: 0.82, c: 0.72 },
  400: { l: 0.73, c: 0.92 },
  500: { l: 0.645, c: 1.0 },
  600: { l: 0.565, c: 0.98 },
  700: { l: 0.485, c: 0.9 },
  800: { l: 0.4, c: 0.76 },
  900: { l: 0.315, c: 0.6 },
};

/**
 * Build a ten-step ramp from one colour.
 *
 * The seed's own lightness is ignored on purpose. A club that hands us a very
 * pale seed and a club that hands us a very dark one should both get a usable
 * ramp — what we take from the seed is its hue and how vivid it wants to be,
 * not where on the scale it happens to sit.
 */
export function buildRamp(seedHex: string): Ramp | null {
  const seed = hexToOklch(seedHex);
  if (!seed) return null;

  // A near-grey seed keeps a trace of its hue so the ramp is warm or cool
  // rather than dead neutral; a vivid seed is capped short of the sRGB edge so
  // the mid steps don't all clamp to the same colour.
  const baseChroma = Math.min(0.185, Math.max(0.012, seed.c));

  const out = {} as Ramp;
  for (const step of RAMP_STEPS) {
    const shape = RAMP_SHAPE[step];
    out[step] = oklchToHex({ l: shape.l, c: baseChroma * shape.c, h: seed.h });
  }
  return out;
}

/**
 * A neutral ramp that leans towards the brand's hue.
 *
 * Pure grey next to a saturated brand colour looks like a mistake — the greys
 * read as dirty. Bending the neutrals a few degrees towards the brand hue is
 * the single cheapest thing that makes a site look designed rather than
 * assembled, and no club officer would ever think to ask for it.
 */
export function buildNeutralRamp(seedHex: string): Ramp | null {
  const seed = hexToOklch(seedHex);
  if (!seed) return null;
  const out = {} as Ramp;
  for (const step of RAMP_STEPS) {
    const shape = RAMP_SHAPE[step];
    // A touch more contrast at the ends than the brand ramp: neutrals carry
    // body text, and body text wants to be nearly black.
    const l = step === 900 ? 0.22 : step === 800 ? 0.31 : shape.l;
    out[step] = oklchToHex({ l, c: 0.006 + 0.012 * shape.c, h: seed.h });
  }
  return out;
}

// ── Brand tokens ──────────────────────────────────────────────────────────────

/** The typeface pairings a club can choose. All self-hosted or system. */
export const FONT_PAIRS = {
  rotary: {
    label: "Rotary standard",
    blurb: "Open Sans throughout, the way Rotary's own materials are set.",
    display: "'Open Sans', 'Segoe UI', system-ui, sans-serif",
    text: "'Open Sans', 'Segoe UI', system-ui, sans-serif",
  },
  classic: {
    label: "Classic",
    blurb: "A serif for headings, a clean sans for reading. Formal without being stiff.",
    display: "Georgia, 'Times New Roman', serif",
    text: "'Open Sans', 'Segoe UI', system-ui, sans-serif",
  },
  modern: {
    label: "Modern",
    blurb: "One family, two weights. Quiet and current.",
    display: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    text: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  editorial: {
    label: "Editorial",
    blurb: "Big serif headlines. Suits a club with a story to tell.",
    display: "'Iowan Old Style', Georgia, serif",
    text: "'Helvetica Neue', Arial, sans-serif",
  },
} as const;

export type FontPairKey = keyof typeof FONT_PAIRS;

export const DENSITIES = ["airy", "regular", "compact"] as const;
export type Density = (typeof DENSITIES)[number];

export interface BrandTokens {
  /** The club's primary colour. Everything else is derived from it. */
  brandHex: string;
  /** The secondary, used for accents and the second button. */
  accentHex: string;
  fontPair: FontPairKey;
  /** Corner radius in pixels, 0–24. Zero reads institutional; 16 reads friendly. */
  radius: number;
  density: Density;
  /** How the club talks. Fed to the drafting prompts, never printed. */
  voice: {
    /** 1 (formal) – 5 (relaxed). */
    warmth: number;
    /** A sentence in the club's own words, e.g. "we're a working lunch club". */
    note: string;
  };
}

export const DEFAULT_TOKENS: BrandTokens = {
  brandHex: "#17458f",
  accentHex: "#f7a81b",
  fontPair: "rotary",
  radius: 10,
  density: "regular",
  voice: { warmth: 3, note: "" },
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/**
 * Coerce anything into usable tokens.
 *
 * Called on every read as well as every write. Tokens become CSS custom
 * properties on a public page, so "it was already in the database" is not a
 * reason to trust a value — a bad row from an old bug would otherwise be a
 * stylesheet injection with a very long fuse.
 */
export function validateTokens(input: unknown): BrandTokens {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const voice = (typeof raw.voice === "object" && raw.voice !== null ? raw.voice : {}) as Record<string, unknown>;

  const brand = parseHex(raw.brandHex) ? String(raw.brandHex).trim().toLowerCase() : DEFAULT_TOKENS.brandHex;
  const accent = parseHex(raw.accentHex) ? String(raw.accentHex).trim().toLowerCase() : DEFAULT_TOKENS.accentHex;

  return {
    brandHex: brand.startsWith("#") ? brand : `#${brand}`,
    accentHex: accent.startsWith("#") ? accent : `#${accent}`,
    fontPair:
      typeof raw.fontPair === "string" && raw.fontPair in FONT_PAIRS
        ? (raw.fontPair as FontPairKey)
        : DEFAULT_TOKENS.fontPair,
    radius: clampInt(raw.radius, 0, 24, DEFAULT_TOKENS.radius),
    density: (DENSITIES as readonly string[]).includes(String(raw.density))
      ? (raw.density as Density)
      : DEFAULT_TOKENS.density,
    voice: {
      warmth: clampInt(voice.warmth, 1, 5, 3),
      note: typeof voice.note === "string" ? voice.note.replace(/\s+/g, " ").trim().slice(0, 240) : "",
    },
  };
}

export function parseTokens(json: string | null | undefined): BrandTokens {
  if (!json) return DEFAULT_TOKENS;
  try {
    return validateTokens(JSON.parse(json));
  } catch {
    return DEFAULT_TOKENS;
  }
}

const SPACING: Record<Density, string> = { airy: "1.35", regular: "1", compact: "0.8" };

/**
 * The step to fill a button with.
 *
 * Not always 600. Around the middle of the ramp there is a band where neither
 * white nor near-black reaches 4.5:1 — a mid green sits right in it, which is
 * how the Grove preset shipped a button at 4.3 until a test caught it. Rather
 * than nudge the ramp shape and disturb every other colour, walk down the ramp
 * until a step passes. A club picking green gets a slightly deeper button than
 * a club picking blue, which nobody will ever notice, and both are legible.
 */
export function solidStep(ramp: Ramp, from: RampStep = 600): RampStep {
  const start = RAMP_STEPS.indexOf(from);
  for (let i = start; i < RAMP_STEPS.length; i++) {
    const step = RAMP_STEPS[i]!;
    if (bestContrast(ramp[step]) >= AA_NORMAL) return step;
  }
  return 900;
}

/**
 * The custom properties a rendered site carries.
 *
 * Returned as an object rather than a string so the renderer can put it in a
 * React `style` prop — React escapes those, which means a token that somehow
 * survived validation still cannot close the attribute and start a script tag.
 */
export function tokensToStyle(tokens: BrandTokens): Record<string, string> {
  const brand = buildRamp(tokens.brandHex) ?? buildRamp(DEFAULT_TOKENS.brandHex)!;
  const accent = buildRamp(tokens.accentHex) ?? buildRamp(DEFAULT_TOKENS.accentHex)!;
  const neutral = buildNeutralRamp(tokens.brandHex) ?? buildNeutralRamp(DEFAULT_TOKENS.brandHex)!;
  const fonts = FONT_PAIRS[tokens.fontPair];

  // The fills a button and an accent band actually use — see solidStep.
  const brandSolid = brand[solidStep(brand)];
  const accentSolid = accent[solidStep(accent, 500)];

  const style: Record<string, string> = {
    "--site-font-display": fonts.display,
    "--site-font-text": fonts.text,
    "--site-radius": `${tokens.radius}px`,
    "--site-space": SPACING[tokens.density],
    "--site-brand-solid": brandSolid,
    "--site-accent-solid": accentSolid,
    // Text that sits on those fills. Computed rather than assumed: Rotary Gold
    // takes dark text, Royal Blue takes white, and a club that picks a mid
    // green needs whichever one actually passes.
    "--site-on-brand": textOn(brandSolid),
    "--site-on-accent": textOn(accentSolid),
  };
  for (const step of RAMP_STEPS) {
    style[`--site-brand-${step}`] = brand[step];
    style[`--site-accent-${step}`] = accent[step];
    style[`--site-ink-${step}`] = neutral[step];
  }
  return style;
}

// ── Telling a club the truth about their colours ──────────────────────────────

export interface ContrastWarning {
  where: string;
  ratio: number;
  message: string;
}

/**
 * Check the pairings a page will actually produce.
 *
 * Mostly a backstop rather than a nag. Because `buildRamp` normalises
 * lightness, a club that picks a very pale or very dark seed still gets a ramp
 * whose 600 takes a button and whose 700 reads as a link — so these four checks
 * are quiet for essentially every real colour, and that is the intended
 * outcome. They exist for the case where somebody changes RAMP_SHAPE and
 * quietly breaks legibility for everyone: this fires in the test suite rather
 * than on a club's site.
 *
 * The one check that fires in ordinary use is the last: two colours so close
 * that the accent stops being an accent. That is a taste mistake the ramp maths
 * cannot fix, so a person has to be told.
 *
 * Shown in the Brand Studio, never enforced. Being blocked by your own website
 * builder over a standard you have never heard of is infuriating. But nobody
 * gets to say they were not told.
 */
export function auditTokens(tokens: BrandTokens): ContrastWarning[] {
  const brand = buildRamp(tokens.brandHex);
  const accent = buildRamp(tokens.accentHex);
  const neutral = buildNeutralRamp(tokens.brandHex);
  if (!brand || !accent || !neutral) return [];

  const warnings: ContrastWarning[] = [];
  const check = (where: string, fg: string, bg: string, min: number, message: string) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio < min) warnings.push({ where, ratio: Math.round(ratio * 10) / 10, message });
  };

  const brandSolid = brand[solidStep(brand)];
  const accentSolid = accent[solidStep(accent, 500)];

  check(
    "Buttons",
    textOn(brandSolid),
    brandSolid,
    AA_NORMAL,
    "Text on your main button is hard to read. A deeper or lighter main colour fixes it.",
  );
  check(
    "Links on white",
    brand[700],
    "#ffffff",
    AA_NORMAL,
    "Links in your main colour are faint against white. Most visitors on a phone in daylight will miss them.",
  );
  check(
    "Body text",
    neutral[900],
    "#ffffff",
    AA_NORMAL,
    "Body text is too pale to read comfortably.",
  );
  check(
    "Accent band",
    textOn(accentSolid),
    accentSolid,
    AA_LARGE,
    "Headings on your accent colour are low contrast. It will look fine on your screen and poor on a projector.",
  );

  const spread = perceptualDistance(tokens.brandHex, tokens.accentHex);
  if (spread < 0.05) {
    warnings.push({
      where: "The two colours",
      ratio: Math.round(spread * 100) / 100,
      message: "Your main and accent colours are so close that the accent won't read as an accent.",
    });
  }

  return warnings;
}
