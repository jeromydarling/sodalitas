/**
 * blocks.ts — what a page is made of, and the gate everything passes through.
 *
 * A page is an ordered array of typed sections. Never HTML. That single choice
 * is what makes the rest of this feature safe and useful at the same time:
 *
 *   **A language model can write a page without being handed a script tag.**
 *   The model returns JSON; this file decides which fields survive. An
 *   `onerror=` attribute has nowhere to land because there are no attributes,
 *   only named fields with declared kinds.
 *
 *   **Some blocks are alive.** `meetings`, `projects` and `officers` read from
 *   the club's real data at render time. That is the actual difference between
 *   this and a website builder: a club's site cannot go stale about its own
 *   meeting time, because nobody typed the meeting time into the site.
 *
 *   **The theme can change under everybody.** Because pages hold content and
 *   not markup, restyling is a token change rather than a migration.
 *
 * Every write — the editor, an AI proposal, an import — goes through
 * `validateBlocks`. It never throws on bad input: it coerces, clamps, drops
 * what it cannot make sense of, and reports what it did. A club whose AI draft
 * came back with eleven stats should see eight stats and a line saying three
 * were dropped, not an error page.
 */

// ── Field kinds ───────────────────────────────────────────────────────────────

export type FieldSpec =
  | { kind: "text"; max: number; label: string; hint?: string; multiline?: boolean }
  | { kind: "url"; label: string; hint?: string }
  | { kind: "enum"; values: readonly string[]; fallback: string; label: string }
  | { kind: "int"; min: number; max: number; fallback: number; label: string }
  | { kind: "bool"; fallback: boolean; label: string }
  | { kind: "media"; label: string; hint?: string }
  | { kind: "icon"; label: string }
  | { kind: "list"; max: number; label: string; of: Record<string, FieldSpec> };

export type Fields = Record<string, FieldSpec>;

/**
 * The icons a block may name.
 *
 * A closed list rather than a free string: the renderer maps these to Lucide
 * glyphs, and an unknown name would either crash the page or silently render
 * nothing. These are the ones a Rotary club actually reaches for.
 */
export const BLOCK_ICONS = [
  "calendar", "users", "heart", "globe", "handshake", "award", "book",
  "leaf", "droplet", "graduation", "stethoscope", "home", "utensils",
  "megaphone", "map-pin", "clock", "mail", "phone", "sparkles", "wheel",
  "ticket", "file-text",
] as const;
export type BlockIcon = (typeof BLOCK_ICONS)[number];

// ── The block catalogue ───────────────────────────────────────────────────────

export interface BlockDef {
  /** What a club officer sees in the "add a section" list. */
  label: string;
  /** One line, written for somebody who has never built a web page. */
  blurb: string;
  icon: BlockIcon;
  /**
   * True when the block reads live club data at render time. Live blocks have
   * almost no editable content — the content is the club's own records — and
   * the editor says so rather than showing an empty form.
   */
  live?: boolean;
  /** Only one of these may exist per page (a page has one hero). */
  once?: boolean;
  fields: Fields;
}

const CTA_FIELDS: Fields = {
  ctaLabel: { kind: "text", max: 40, label: "Button text" },
  ctaHref: { kind: "url", label: "Button link", hint: "A page on this site, or an https:// address" },
};

export const BLOCKS = {
  hero: {
    label: "Hero",
    blurb: "The first thing a visitor sees: a headline, a sentence, and one thing to do.",
    icon: "sparkles",
    once: true,
    fields: {
      eyebrow: { kind: "text", max: 60, label: "Small line above the headline" },
      heading: { kind: "text", max: 120, label: "Headline" },
      body: { kind: "text", max: 400, label: "One or two sentences", multiline: true },
      ...CTA_FIELDS,
      secondaryLabel: { kind: "text", max: 40, label: "Second button text" },
      secondaryHref: { kind: "url", label: "Second button link" },
      mediaId: { kind: "media", label: "Photograph" },
      layout: {
        kind: "enum",
        values: ["split", "centred", "banner"],
        fallback: "split",
        label: "Layout",
      },
    },
  },

  richText: {
    label: "Words",
    blurb: "A heading and some paragraphs. The workhorse.",
    icon: "book",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      body: { kind: "text", max: 4000, label: "Text", multiline: true, hint: "Blank lines separate paragraphs" },
      align: { kind: "enum", values: ["left", "centre"], fallback: "left", label: "Alignment" },
    },
  },

  stats: {
    label: "Numbers",
    blurb: "Three or four figures the club is proud of. Real ones.",
    icon: "award",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      items: {
        kind: "list",
        max: 4,
        label: "Figures",
        of: {
          // Deliberately text, not a number: "$41,200", "1,100 hours", "Since 1948".
          value: { kind: "text", max: 20, label: "Figure" },
          label: { kind: "text", max: 60, label: "What it counts" },
          note: { kind: "text", max: 100, label: "Small print" },
        },
      },
    },
  },

  cards: {
    label: "Cards",
    blurb: "A grid of short items — committees, areas of focus, ways to help.",
    icon: "users",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      intro: { kind: "text", max: 300, label: "Intro", multiline: true },
      columns: { kind: "int", min: 2, max: 4, fallback: 3, label: "Columns" },
      items: {
        kind: "list",
        max: 12,
        label: "Cards",
        of: {
          icon: { kind: "icon", label: "Icon" },
          title: { kind: "text", max: 80, label: "Title" },
          body: { kind: "text", max: 300, label: "Text", multiline: true },
          href: { kind: "url", label: "Link" },
        },
      },
    },
  },

  meetings: {
    label: "Upcoming meetings",
    blurb: "Pulls the next meetings straight from the club's calendar. Never out of date.",
    icon: "calendar",
    live: true,
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      intro: { kind: "text", max: 300, label: "Intro", multiline: true },
      count: { kind: "int", min: 1, max: 12, fallback: 4, label: "How many to show" },
      showSpeaker: { kind: "bool", fallback: true, label: "Show the speaker and topic" },
      showLocation: { kind: "bool", fallback: true, label: "Show where it meets" },
      emptyText: {
        kind: "text",
        max: 200,
        label: "What to say when nothing is scheduled",
        multiline: true,
      },
    },
  },

  events: {
    label: "What's on",
    blurb: "The club's public events, with a link to register. Pulled live, so it can't go stale.",
    icon: "ticket",
    live: true,
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      intro: { kind: "text", max: 300, label: "Intro", multiline: true },
      count: { kind: "int", min: 1, max: 12, fallback: 3, label: "How many to show" },
      showPrice: { kind: "bool", fallback: true, label: "Show what a ticket costs" },
      emptyText: {
        kind: "text",
        max: 200,
        label: "What to say when nothing is scheduled",
        multiline: true,
      },
    },
  },

  documents: {
    label: "Documents",
    blurb:
      "Public documents from the club's library — bylaws, forms, annual reports. Only ever the ones marked public.",
    icon: "file-text",
    live: true,
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      intro: { kind: "text", max: 300, label: "Intro", multiline: true },
      count: { kind: "int", min: 1, max: 24, fallback: 6, label: "How many to show" },
      // Not a picker of individual documents. A club that curates a list here
      // has two places to keep in step and will forget one; the library's own
      // visibility setting is the single control, and this block obeys it.
      folderSlug: { kind: "text", max: 60, label: "Only from this folder (optional)" },
      showSize: { kind: "bool", fallback: true, label: "Show the file size" },
    },
  },

  projects: {
    label: "Service projects",
    blurb: "The club's public projects, from the club's own records.",
    icon: "handshake",
    live: true,
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      intro: { kind: "text", max: 300, label: "Intro", multiline: true },
      count: { kind: "int", min: 1, max: 12, fallback: 3, label: "How many to show" },
      showArea: { kind: "bool", fallback: true, label: "Show the area of focus" },
    },
  },

  officers: {
    label: "This year's officers",
    blurb: "Current officers by name and office. Never the whole roster.",
    icon: "award",
    live: true,
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      intro: { kind: "text", max: 300, label: "Intro", multiline: true },
    },
  },

  join: {
    label: "Get in touch",
    blurb: "A short form. Anyone who fills it in lands in the club's prospective members.",
    icon: "mail",
    once: true,
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      body: { kind: "text", max: 400, label: "Intro", multiline: true },
      buttonLabel: { kind: "text", max: 40, label: "Button text" },
      thanksText: { kind: "text", max: 300, label: "What to say afterwards", multiline: true },
    },
  },

  donate: {
    label: "Donate",
    blurb: "Takes a card straight into the club's own Stripe account. Hidden until that's connected.",
    icon: "heart",
    once: true,
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      body: { kind: "text", max: 400, label: "Why give", multiline: true },
    },
  },

  gallery: {
    label: "Photographs",
    blurb: "A grid of the club's own pictures.",
    icon: "globe",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      columns: { kind: "int", min: 2, max: 4, fallback: 3, label: "Columns" },
      items: {
        kind: "list",
        max: 16,
        label: "Pictures",
        of: {
          mediaId: { kind: "media", label: "Picture" },
          caption: { kind: "text", max: 140, label: "Caption" },
        },
      },
    },
  },

  faq: {
    label: "Questions",
    blurb: "Questions and answers. Also tells Google and AI assistants what the club is.",
    icon: "book",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      items: {
        kind: "list",
        max: 12,
        label: "Questions",
        of: {
          q: { kind: "text", max: 200, label: "Question" },
          a: { kind: "text", max: 1200, label: "Answer", multiline: true },
        },
      },
    },
  },

  timeline: {
    label: "History",
    blurb: "The club's story, one year at a time.",
    icon: "clock",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      items: {
        kind: "list",
        max: 20,
        label: "Moments",
        of: {
          when: { kind: "text", max: 24, label: "Year" },
          title: { kind: "text", max: 100, label: "What happened" },
          body: { kind: "text", max: 400, label: "Detail", multiline: true },
        },
      },
    },
  },

  quote: {
    label: "Quote",
    blurb: "Something a member or a partner actually said.",
    icon: "megaphone",
    fields: {
      body: { kind: "text", max: 500, label: "The quote", multiline: true },
      attribution: { kind: "text", max: 80, label: "Who said it" },
      role: { kind: "text", max: 100, label: "Their role" },
      mediaId: { kind: "media", label: "Their photograph" },
    },
  },

  logos: {
    label: "Partners",
    blurb: "A quiet strip of the organisations the club works with.",
    icon: "handshake",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      items: {
        kind: "list",
        max: 12,
        label: "Partners",
        of: {
          mediaId: { kind: "media", label: "Logo" },
          name: { kind: "text", max: 80, label: "Name" },
          href: { kind: "url", label: "Their website" },
        },
      },
    },
  },

  contact: {
    label: "Where and when",
    blurb: "Meeting time, address and how to reach the club.",
    icon: "map-pin",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      meetsText: { kind: "text", max: 200, label: "When it meets" },
      addressText: { kind: "text", max: 300, label: "Address", multiline: true },
      email: { kind: "text", max: 160, label: "Email" },
      phone: { kind: "text", max: 40, label: "Phone" },
      mapHref: { kind: "url", label: "Link to a map" },
    },
  },

  cta: {
    label: "Call to action",
    blurb: "A band with one clear thing to do.",
    icon: "megaphone",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      body: { kind: "text", max: 300, label: "Text", multiline: true },
      ...CTA_FIELDS,
      tone: { kind: "enum", values: ["brand", "gold", "quiet"], fallback: "brand", label: "Colour" },
    },
  },

  video: {
    label: "Video",
    blurb: "A YouTube or Vimeo video. Paste the address — we take it from there.",
    icon: "globe",
    fields: {
      heading: { kind: "text", max: 120, label: "Heading" },
      // The *id*, not markup. See parseVideo below: a club pastes a URL and the
      // editor stores what it extracted. Nothing here ever becomes an iframe
      // src without going through that function again at render time.
      provider: { kind: "enum", values: ["youtube", "vimeo"], fallback: "youtube", label: "Where it's hosted" },
      videoId: { kind: "text", max: 40, label: "Video id" },
      caption: { kind: "text", max: 200, label: "Caption" },
    },
  },

  divider: {
    label: "Divider",
    blurb: "A little breathing room.",
    icon: "leaf",
    fields: {
      style: { kind: "enum", values: ["rule", "space", "wheel"], fallback: "rule", label: "Style" },
    },
  },
} as const satisfies Record<string, BlockDef>;

export type BlockType = keyof typeof BLOCKS;
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];

export function isBlockType(t: unknown): t is BlockType {
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(BLOCKS, t);
}

/** A validated block. Field values are only ever the kinds declared above. */
export interface Block {
  id: string;
  type: BlockType;
  [field: string]: unknown;
}

// ── URLs ──────────────────────────────────────────────────────────────────────

/**
 * What a link field is allowed to be.
 *
 * A site link comes from a club officer or from a language model, and it ends
 * up in an `href` on a page anyone can read. `javascript:` and `data:` are the
 * obvious ones; `http:` is excluded because every one of these sites is served
 * over TLS and a mixed-content link is a browser warning on somebody else's
 * page. Relative paths are allowed so a club can link between their own pages.
 */
export function safeHref(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  // A same-site path. One leading slash only: "//evil.example" is a
  // protocol-relative URL, not a path.
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw.slice(0, 300);
  if (raw.startsWith("#")) return raw.slice(0, 120);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:") {
    return url.href.slice(0, 500);
  }
  return "";
}

/**
 * Pull a provider and id out of a pasted video address.
 *
 * The club pastes whatever their browser had in the bar. We extract an id and
 * store only that — the same "paste an id, never markup" rule the analytics
 * settings follow, for the same reason: the alternative is accepting an embed
 * snippet, and an embed snippet is a script tag with a friendly face.
 */
export function parseVideo(input: string): { provider: "youtube" | "vimeo"; videoId: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  // A bare id, already extracted.
  if (/^[A-Za-z0-9_-]{6,20}$/.test(raw)) return { provider: "youtube", videoId: raw };
  if (/^\d{6,12}$/.test(raw)) return { provider: "vimeo", videoId: raw };

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? { provider: "youtube", videoId: id } : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = url.searchParams.get("v") ?? url.pathname.split("/").pop() ?? "";
    return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? { provider: "youtube", videoId: id } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return /^\d{6,12}$/.test(id) ? { provider: "vimeo", videoId: id } : null;
  }
  return null;
}

/** The only iframe source a video block can produce. */
export function videoEmbedSrc(provider: string, videoId: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(videoId)) return null;
  if (provider === "youtube") return `https://www.youtube-nocookie.com/embed/${videoId}`;
  if (provider === "vimeo" && /^\d+$/.test(videoId)) return `https://player.vimeo.com/video/${videoId}`;
  return null;
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Collapse whitespace runs and strip control characters, keeping newlines. */
function cleanText(value: unknown, max: number): string {
  if (typeof value === "number" || typeof value === "boolean") value = String(value);
  if (typeof value !== "string") return "";
  return value
    // Control characters, minus \n and \t which are meaningful here. They have
    // no business in page copy and a stray NUL breaks a JSON round-trip.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** A media reference is an id we minted or nothing. Never a URL. */
function cleanMediaId(value: unknown): string {
  return typeof value === "string" && /^sm_[0-9A-Z]{22}$/.test(value) ? value : "";
}

function cleanField(spec: FieldSpec, value: unknown): unknown {
  switch (spec.kind) {
    case "text":
      return cleanText(value, spec.max);
    case "url":
      return safeHref(value);
    case "enum":
      return typeof value === "string" && spec.values.includes(value) ? value : spec.fallback;
    case "int": {
      const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
      if (!Number.isFinite(n)) return spec.fallback;
      return Math.min(spec.max, Math.max(spec.min, Math.round(n)));
    }
    case "bool":
      if (value === undefined || value === null || value === "") return spec.fallback;
      return value === true || value === "true" || value === 1 || value === "1" || value === "on";
    case "media":
      return cleanMediaId(value);
    case "icon":
      return typeof value === "string" && (BLOCK_ICONS as readonly string[]).includes(value)
        ? value
        : "";
    case "list":
      return []; // handled by the caller, which needs to report what it dropped
  }
}

export interface ValidationNote {
  /** Index of the block in the submitted array, for pointing at it in the UI. */
  index: number;
  message: string;
}

export interface ValidatedPage {
  blocks: Block[];
  /** What we changed, in words a club officer can act on. Never silent. */
  notes: ValidationNote[];
}

/** How many sections one page may hold. Generous; not unbounded. */
export const MAX_BLOCKS = 40;

let counter = 0;
/** Ids only need to be unique within a page, and stable across a render. */
function blockId(): string {
  counter = (counter + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * Turn anything into a valid page.
 *
 * Never throws. Input arrives from three places — a form, a language model, and
 * our own database — and exactly one of them is trustworthy. Treating all three
 * the same way is cheaper than remembering which.
 */
export function validateBlocks(input: unknown): ValidatedPage {
  const notes: ValidationNote[] = [];
  const blocks: Block[] = [];

  const list = Array.isArray(input) ? input : [];
  if (!Array.isArray(input) && input != null) {
    notes.push({ index: -1, message: "That wasn't a list of sections, so we started an empty page." });
  }
  if (list.length > MAX_BLOCKS) {
    notes.push({
      index: -1,
      message: `A page holds ${MAX_BLOCKS} sections; the last ${list.length - MAX_BLOCKS} were dropped.`,
    });
  }

  const seenOnce = new Set<string>();

  list.slice(0, MAX_BLOCKS).forEach((rawBlock, index) => {
    if (typeof rawBlock !== "object" || rawBlock === null) {
      notes.push({ index, message: "Skipped a section that wasn't a section." });
      return;
    }
    const raw = rawBlock as Record<string, unknown>;
    const type = raw.type;
    if (!isBlockType(type)) {
      notes.push({ index, message: `Skipped an unknown section type: ${String(type).slice(0, 40)}.` });
      return;
    }
    const def: BlockDef = BLOCKS[type];

    if (def.once) {
      if (seenOnce.has(type)) {
        notes.push({ index, message: `A page has one ${def.label.toLowerCase()}; the extra was dropped.` });
        return;
      }
      seenOnce.add(type);
    }

    const block: Block = {
      id: typeof raw.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : blockId(),
      type,
    };

    for (const [name, spec] of Object.entries(def.fields as Fields)) {
      if (spec.kind === "list") {
        const items = Array.isArray(raw[name]) ? (raw[name] as unknown[]) : [];
        if (items.length > spec.max) {
          notes.push({
            index,
            message: `${def.label}: kept ${spec.max} ${spec.label.toLowerCase()}, dropped ${items.length - spec.max}.`,
          });
        }
        block[name] = items.slice(0, spec.max).map((item) => {
          const src = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          for (const [k, s] of Object.entries(spec.of)) out[k] = cleanField(s, src[k]);
          return out;
        });
      } else {
        block[name] = cleanField(spec, raw[name]);
      }
    }

    blocks.push(block);
  });

  return { blocks, notes };
}

/** Parse the JSON column, defensively. A corrupt row renders an empty page. */
export function parseBlocks(json: string | null | undefined): Block[] {
  if (!json) return [];
  try {
    return validateBlocks(JSON.parse(json)).blocks;
  } catch {
    return [];
  }
}

export function serialiseBlocks(blocks: Block[]): string {
  return JSON.stringify(blocks);
}

// ── Reading a page ────────────────────────────────────────────────────────────

/** Which live data a page needs, so the loader fetches only what it renders. */
export function liveDataNeeded(blocks: Block[]): {
  meetings: number;
  projects: number;
  events: number;
  documents: number;
  /** Folders named by document blocks. Empty means "anywhere in the library". */
  documentFolders: string[];
  officers: boolean;
  donate: boolean;
  join: boolean;
} {
  let meetings = 0;
  let projects = 0;
  let events = 0;
  let documents = 0;
  const documentFolders = new Set<string>();
  let officers = false;
  let donate = false;
  let join = false;
  for (const b of blocks) {
    if (b.type === "meetings") meetings = Math.max(meetings, Number(b.count) || 4);
    if (b.type === "projects") projects = Math.max(projects, Number(b.count) || 3);
    if (b.type === "events") events = Math.max(events, Number(b.count) || 3);
    if (b.type === "documents") {
      documents = Math.max(documents, Number(b.count) || 6);
      if (typeof b.folderSlug === "string" && b.folderSlug) documentFolders.add(b.folderSlug);
    }
    if (b.type === "officers") officers = true;
    if (b.type === "donate") donate = true;
    if (b.type === "join") join = true;
  }
  return {
    meetings,
    projects,
    events,
    documents,
    documentFolders: [...documentFolders],
    officers,
    donate,
    join,
  };
}

/**
 * The page's own description, for `<meta name="description">` when nobody wrote
 * one. Drawn from the first prose the page actually contains rather than from a
 * template, because a page whose description reads "Welcome to our club" ranks
 * exactly as well as no description at all.
 */
export function derivedDescription(blocks: Block[]): string {
  for (const b of blocks) {
    const candidate =
      (b.type === "hero" && b.body) ||
      (b.type === "richText" && b.body) ||
      (b.type === "cta" && b.body) ||
      "";
    const text = typeof candidate === "string" ? candidate.replace(/\s+/g, " ").trim() : "";
    if (text.length >= 40) return text.slice(0, 300);
  }
  return "";
}

/** Paragraphs, for the one field where blank lines mean something. */
export function paragraphs(text: unknown): string[] {
  if (typeof text !== "string") return [];
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
