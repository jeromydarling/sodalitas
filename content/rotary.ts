/**
 * rotary.ts — the Rotary brand, as a working kit rather than a PDF.
 *
 * Every club is a licensed user of one of the strongest brands in the
 * non-profit world and almost none of them use it properly, because using it
 * properly means reading a 40-page guide, finding the right EPS, and knowing
 * what "clear space" means. The result is 30,000 club websites in
 * approximately 30,000 shades of blue.
 *
 * So the guidance lives here as data: real palette values, real typeface
 * pairings, the areas of focus with their own colours, and the sentence
 * structures the People of Action campaign is built on. The Brand Studio reads
 * from this, the AI drafting prompts read from this, and a club that never
 * opens a guideline still ends up on-brand.
 *
 * **Two honest caveats, kept next to the data so nobody has to go looking.**
 *
 * Rotary International owns the Rotary marks. A club is licensed to use them;
 * Sodalitas is not, and nothing here is endorsed by or affiliated with Rotary
 * International. We ship colour values and layout advice — never the emblem
 * itself. A club uploads their own club logo, obtained from the Brand Center
 * where they have every right to it.
 *
 * These values were taken from Rotary's published identity system. Brands get
 * revised. Where a club's district has told them something different, the
 * district is right and this file is stale — which is why every one of these is
 * a default a club can change rather than a rule the software enforces.
 */

import { hexToOklch, perceptualDistance } from "@domain/palette";

export const BRAND_CENTER_URL = "https://brandcenter.rotary.org/";

/**
 * The palette.
 *
 * Royal Blue and Gold are the primaries — they are the emblem. Everything else
 * is a secondary, meant for accents, areas of focus and charts, and meant to be
 * used one or two at a time. A page using nine of these is a page that has
 * misunderstood the system.
 */
export const ROTARY_COLOURS = [
  {
    key: "royal_blue",
    name: "Royal Blue",
    hex: "#17458f",
    role: "primary",
    use: "The Rotary blue. Headers, buttons, anything that has to read as official.",
  },
  {
    key: "gold",
    name: "Gold",
    hex: "#f7a81b",
    role: "primary",
    use: "The second half of the emblem. An accent — a rule, a highlight, one button. Never a background for body text.",
  },
  {
    key: "azure",
    name: "Azure",
    hex: "#0067c8",
    role: "secondary",
    use: "A brighter, friendlier blue. Good for a club that wants to look current without leaving the palette.",
  },
  {
    key: "sky_blue",
    name: "Sky Blue",
    hex: "#00a2e0",
    role: "secondary",
    use: "Light and open. Works as an accent on dark blue.",
  },
  {
    key: "cranberry",
    name: "Cranberry",
    hex: "#d41367",
    role: "secondary",
    use: "Warm and energetic. Popular with Rotaract clubs.",
  },
  {
    key: "cardinal",
    name: "Cardinal",
    hex: "#e02927",
    role: "secondary",
    use: "Urgent and human. Used sparingly — it is a loud colour.",
  },
  {
    key: "orange",
    name: "Orange",
    hex: "#ff7600",
    role: "secondary",
    use: "Bright and informal. Suits a club whose thing is the pancake breakfast.",
  },
  {
    key: "turquoise",
    name: "Turquoise",
    hex: "#00adbb",
    role: "secondary",
    use: "Calm. The water and sanitation work uses it.",
  },
  {
    key: "grass",
    name: "Grass",
    hex: "#009739",
    role: "secondary",
    use: "Growth and environment. A natural fit for a club known for its tree planting.",
  },
  {
    key: "violet",
    name: "Violet",
    hex: "#901f93",
    role: "secondary",
    use: "The polio colour. Purple for the pinky.",
  },
  {
    key: "slate",
    name: "Slate",
    hex: "#5b6770",
    role: "neutral",
    use: "A cool grey for secondary text and rules.",
  },
  {
    key: "charcoal",
    name: "Charcoal",
    hex: "#58595b",
    role: "neutral",
    use: "Body text on white, if you want to be softer than black.",
  },
  {
    key: "smoke",
    name: "Smoke",
    hex: "#c7c8ca",
    role: "neutral",
    use: "Borders, dividers, the quiet background of a card.",
  },
] as const;

export type RotaryColourKey = (typeof ROTARY_COLOURS)[number]["key"];

export function rotaryColour(key: string): (typeof ROTARY_COLOURS)[number] | undefined {
  return ROTARY_COLOURS.find((c) => c.key === key);
}

/**
 * The seven areas of focus.
 *
 * These are how Rotary describes its own work, and a club that tags its
 * projects with them gets two things at once: a site that speaks Rotary, and
 * numbers that roll up to the district in a shape the district already uses.
 *
 * The colours are the ones Rotary's own materials pair with each cause.
 */
export const AREAS_OF_FOCUS = [
  {
    key: "peace",
    name: "Peacebuilding and conflict prevention",
    short: "Peace",
    colour: "sky_blue",
    icon: "globe",
    blurb: "Training peace fellows, running exchanges, and the quieter work of getting people in a room.",
  },
  {
    key: "disease",
    name: "Disease prevention and treatment",
    short: "Disease prevention",
    colour: "cardinal",
    icon: "stethoscope",
    blurb: "Clinics, screenings, vaccination drives, and the polio work that is nearly finished.",
  },
  {
    key: "water",
    name: "Water, sanitation and hygiene",
    short: "Water",
    colour: "turquoise",
    icon: "droplet",
    blurb: "Wells, filters, latrines, and teaching the hygiene that makes them count.",
  },
  {
    key: "maternal",
    name: "Maternal and child health",
    short: "Mothers and children",
    colour: "cranberry",
    icon: "heart",
    blurb: "Prenatal care, immunisation, and getting nurses trained where there aren't any.",
  },
  {
    key: "education",
    name: "Basic education and literacy",
    short: "Education",
    colour: "orange",
    icon: "graduation",
    blurb: "Books, tutoring, adult literacy, and the scholarship your club has quietly funded for thirty years.",
  },
  {
    key: "economic",
    name: "Community economic development",
    short: "Economic development",
    colour: "violet",
    icon: "handshake",
    blurb: "Microloans, vocational training, and small businesses that outlast the grant.",
  },
  {
    key: "environment",
    name: "Environment",
    short: "Environment",
    colour: "grass",
    icon: "leaf",
    blurb: "The newest one. Trees, rivers, and the projects clubs were doing anyway before it had a name.",
  },
] as const;

export type AreaKey = (typeof AREAS_OF_FOCUS)[number]["key"];

/**
 * Typography.
 *
 * Rotary's identity uses a humanist sans throughout, with a serif permitted for
 * long-form. We can't licence and serve Rotary's own headline face on a club's
 * behalf, so the pairings offered are the substitutes Rotary's own guidance
 * accepts, plus two that are simply good and don't pretend otherwise.
 */
export const TYPE_GUIDANCE = {
  headline:
    "Sentence case, not Title Case. Rotary's own headlines read like sentences — \"We're people of action\" — and a club page in Title Case reads like a press release from 1998.",
  body: "Open Sans at 17–19px, generous line height. Clubs skew older than the web average and the single most common complaint about a club site is that it's too small to read.",
  measure: "65–75 characters a line. Wider and the eye loses its place returning to the left margin.",
} as const;

/**
 * Logo rules, in the four sentences that actually matter.
 *
 * The full guidance runs to pages; these are the four things clubs get wrong.
 */
export const LOGO_RULES = [
  {
    title: "Use your club signature, not a wheel on its own",
    body: "The Mark of Excellence — the wheel — belongs with the word Rotary and your club's name beside it. A bare wheel is the one thing Rotary explicitly asks clubs not to do.",
  },
  {
    title: "Leave it room",
    body: "Clear space around the logo of at least the height of the wheel's hub. Crowding it against a headline is the fastest way to look homemade.",
  },
  {
    title: "Don't recolour it",
    body: "Royal Blue and Gold, or a single solid colour where printing demands it. Not your club's own blue, however close.",
  },
  {
    title: "Get the file from the Brand Center",
    body: `Your club signature can be generated free at ${BRAND_CENTER_URL} — you're licensed to have it. A logo traced off the district newsletter will look like one.`,
  },
] as const;

/**
 * People of Action — the campaign framework, as sentence shapes.
 *
 * Rotary's public-image work is built on a simple structure: the people, what
 * they did, and what changed. It works because it is specific. These are the
 * shapes the AI drafting prompts are told to follow, and the ones the Brand
 * Studio offers a club writing their own.
 */
export const PEOPLE_OF_ACTION = {
  premise:
    "Rotary's public image campaign. The idea is that a club is not a lunch — it's a group of people who did a specific thing that had a specific result.",
  structure: [
    {
      step: "The problem, locally",
      guidance: "Name the actual place and the actual problem. Not \"food insecurity\" — \"the pantry on Third Street ran out by Thursday\".",
    },
    {
      step: "What the club did",
      guidance: "The verb matters more than the adjective. Built, funded, drove, taught, dug. Not \"partnered to facilitate\".",
    },
    {
      step: "What changed",
      guidance: "A number if there's a real one, a person if there isn't. Never a number you had to invent to have one.",
    },
  ],
  headlines: [
    "People of action: {verb} {thing}",
    "We {verb} {thing} — {number} {unit} since {year}",
    "{Place} needed {thing}. So we {verb}.",
  ],
  avoid: [
    "\"Service above self\" as a headline — it's the motto, not a message, and it means nothing to a visitor who isn't already in.",
    "Stock photographs of handshakes. Use a real photograph of the club, badly lit, over a good one of strangers.",
    "Listing the board before saying what the club does.",
  ],
} as const;

/**
 * The brand voice, in Rotary's own terms.
 *
 * Rotary describes its personality as smart, compassionate, persevering and
 * inspiring. Useful precisely because it is not "friendly and professional" —
 * persevering, in particular, is what forty years of polio work sounds like,
 * and it is the note most club websites miss.
 */
export const BRAND_VOICE = {
  traits: [
    { key: "smart", note: "Specific and unsentimental. A figure beats an adjective." },
    { key: "compassionate", note: "About people, not about the club's own goodness." },
    { key: "persevering", note: "Long time horizons. \"Since 1987\" is a stronger claim than \"exciting new\"." },
    { key: "inspiring", note: "Show the work; let the reader do the admiring." },
  ],
  never: [
    "Religious language — Rotary is deliberately non-sectarian.",
    "Political positions or endorsements.",
    "Anything that reads as recruiting-by-guilt.",
  ],
} as const;

// ── Presets ───────────────────────────────────────────────────────────────────

export interface BrandPreset {
  key: string;
  name: string;
  blurb: string;
  brandHex: string;
  accentHex: string;
  fontPair: "rotary" | "classic" | "modern" | "editorial";
  radius: number;
  density: "airy" | "regular" | "compact";
}

/**
 * Starting points.
 *
 * Every one of these is inside the Rotary palette, so a club that picks any of
 * them is on-brand without having thought about it. `royal` is the default
 * because it is the emblem; the rest exist because a club whose only choice is
 * the obvious one will go and pick something off-palette instead.
 */
export const BRAND_PRESETS: BrandPreset[] = [
  {
    key: "royal",
    name: "Royal",
    blurb: "Royal Blue and Gold. The emblem, straight. Safe, formal, unmistakably Rotary.",
    brandHex: "#17458f",
    accentHex: "#f7a81b",
    fontPair: "rotary",
    radius: 8,
    density: "regular",
  },
  {
    key: "azure",
    name: "Azure",
    blurb: "A brighter blue with gold. Reads younger without leaving the palette.",
    brandHex: "#0067c8",
    accentHex: "#f7a81b",
    fontPair: "modern",
    radius: 14,
    density: "airy",
  },
  {
    key: "harbour",
    name: "Harbour",
    blurb: "Royal Blue with turquoise. For a club whose work is water.",
    brandHex: "#17458f",
    accentHex: "#00adbb",
    fontPair: "rotary",
    radius: 10,
    density: "regular",
  },
  {
    key: "grove",
    name: "Grove",
    blurb: "Grass green with gold. Environment-focused clubs, and anyone tired of blue.",
    brandHex: "#009739",
    accentHex: "#f7a81b",
    fontPair: "classic",
    radius: 6,
    density: "regular",
  },
  {
    key: "rotaract",
    name: "Rotaract",
    blurb: "Cranberry with azure. Louder and looser — built for a Rotaract club's audience.",
    brandHex: "#d41367",
    accentHex: "#0067c8",
    fontPair: "modern",
    radius: 18,
    density: "airy",
  },
  {
    key: "charter",
    name: "Charter",
    blurb: "Deep blue, serif headlines, square corners. A club with a 1923 charter and no wish to hide it.",
    brandHex: "#17458f",
    accentHex: "#901f93",
    fontPair: "editorial",
    radius: 0,
    density: "compact",
  },
];

export function brandPreset(key: string): BrandPreset | undefined {
  return BRAND_PRESETS.find((p) => p.key === key);
}

// ── Staying on palette ────────────────────────────────────────────────────────

/**
 * The nearest Rotary colour to an arbitrary one, measured perceptually.
 *
 * Hex distance is useless here — `#17458f` and `#8f4517` are the same distance
 * apart in RGB as two shades of the same blue. OKLab distance is close enough
 * to "how different do these look" that the answer is never surprising.
 */
export function nearestRotaryColour(
  hex: string,
): { colour: (typeof ROTARY_COLOURS)[number]; distance: number } | null {
  if (!hexToOklch(hex)) return null;

  let best: { colour: (typeof ROTARY_COLOURS)[number]; distance: number } | null = null;
  for (const colour of ROTARY_COLOURS) {
    const distance = perceptualDistance(hex, colour.hex);
    if (!best || distance < best.distance) best = { colour, distance };
  }
  return best;
}

/**
 * How close counts as "that is the Rotary colour". Roughly the point at which
 * two swatches side by side stop looking like a mistake and start looking like
 * the same colour.
 */
const ON_PALETTE = 0.045;

/**
 * A note for the Brand Studio when a club has drifted off palette.
 *
 * Advisory, never a block. A club is entitled to its own colours — plenty have
 * a local identity older than the current Rotary guidelines. But the commonest
 * cause of an off-palette blue is nobody knowing there was a palette, and a
 * sentence naming the nearest official colour costs a club nothing to ignore.
 */
export function paletteAdvice(brandHex: string, accentHex: string): string | null {
  const off: string[] = [];
  for (const [label, hex] of [["main", brandHex], ["accent", accentHex]] as const) {
    const near = nearestRotaryColour(hex);
    if (near && near.distance > ON_PALETTE) {
      off.push(`your ${label} colour is close to Rotary ${near.colour.name} (${near.colour.hex})`);
    }
  }
  if (off.length === 0) return null;
  return `Not quite the Rotary palette — ${off.join(", and ")}. Yours is fine to keep; switching makes club material match district and RI material without anyone having to think about it.`;
}

// ── Themes ────────────────────────────────────────────────────────────────────

/**
 * Layout families. Structure, not colour — a theme decides how a hero is built
 * and how wide the measure runs; the brand kit decides what colour it is.
 */
export const SITE_THEMES = [
  {
    key: "classic",
    name: "Classic",
    blurb: "Centred, generous, a photograph up top. What most club sites should be.",
  },
  {
    key: "civic",
    name: "Civic",
    blurb: "A solid brand band across the top, tighter type. Reads institutional and trustworthy.",
  },
  {
    key: "editorial",
    name: "Editorial",
    blurb: "Big headlines, lots of white, photographs that run wide. For a club with good pictures.",
  },
  {
    key: "compact",
    name: "Compact",
    blurb: "Everything a visitor needs above the fold. Best when the site is mainly meeting times and a join form.",
  },
] as const;

export type ThemeKey = (typeof SITE_THEMES)[number]["key"];

export function isThemeKey(k: unknown): k is ThemeKey {
  return typeof k === "string" && SITE_THEMES.some((t) => t.key === k);
}
