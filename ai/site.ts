/**
 * site.ts — the AI half of the website builder.
 *
 * Three jobs: draft a page, propose a brand, and polish a paragraph a human
 * already wrote. All three are the same shape and the same posture as every
 * other AI feature here — a proposal lands in a version row, a person reads it,
 * a person applies it. Nothing on this path can publish.
 *
 * **What stops it inventing a club.** The prompt is built from the club's own
 * record: its real name, its real charter year, its real projects, its real
 * meeting time. Anything the model would like but was not given, it must write
 * as `[ ]` — a blank a secretary fills in ten seconds, rather than a plausible
 * sentence about a food drive that never happened. That rule is repeated in the
 * system prompt, restated for the one block where it matters most (`stats`,
 * which is nothing but numbers), and then enforced afterwards: `scrubInvented`
 * strips figures the model produced that we never supplied.
 *
 * **What stops it producing markup.** It doesn't emit HTML at all. It emits
 * JSON against the block registry, and the result goes through
 * `validateBlocks`, which knows the fields and drops everything else. The
 * schema shown to the model is *generated from* the registry, so a block added
 * next month is offered without anyone remembering to edit a prompt.
 */

import { draft, isConfigured, NOT_CONFIGURED, PROMPT_VERSION, type AiEnv, type AiResult } from "./provider";
import {
  BLOCKS,
  BLOCK_ICONS,
  validateBlocks,
  type Block,
  type BlockDef,
  type Fields,
  type ValidationNote,
} from "@domain/blocks";
import { validateTokens, type BrandTokens } from "@domain/palette";
import { BRAND_PRESETS, BRAND_VOICE, PEOPLE_OF_ACTION, ROTARY_COLOURS } from "@content/rotary";
import type { TenantDb } from "@db/scope";

// ── The facts a club actually has ─────────────────────────────────────────────

/**
 * Everything the model is allowed to know.
 *
 * Deliberately a closed shape rather than "here's the club row". A field that
 * doesn't appear here can't reach a prompt, which is how member names and email
 * addresses stay out of one — a club's website copy has no business being
 * drafted from its roster.
 */
export interface ClubFacts {
  name: string;
  city: string | null;
  stateCode: string | null;
  charterYear: string | null;
  /** "Thursdays at 12:00", already formatted. */
  meets: string | null;
  location: string | null;
  /** Public projects only — name, area of focus, one-line summary. */
  projects: { name: string; area: string | null; summary: string | null }[];
  /** Counts the club can stand behind, because they came out of its own data. */
  figures: { label: string; value: string }[];
  /** Anything the club typed about itself. The best input there is. */
  notes: string | null;
}

export function factsBlock(facts: ClubFacts): string {
  const lines = [
    `Club name: ${facts.name}`,
    facts.city ? `Town: ${facts.city}${facts.stateCode ? `, ${facts.stateCode}` : ""}` : null,
    facts.charterYear ? `Chartered: ${facts.charterYear}` : null,
    facts.meets ? `Meets: ${facts.meets}` : null,
    facts.location ? `Meeting place: ${facts.location}` : null,
  ].filter(Boolean);

  if (facts.projects.length) {
    lines.push("Service projects (these are real; describe only these):");
    for (const p of facts.projects.slice(0, 10)) {
      lines.push(`  - ${p.name}${p.area ? ` [${p.area}]` : ""}${p.summary ? `: ${p.summary}` : ""}`);
    }
  } else {
    lines.push("Service projects: none recorded. Do not describe any specific project.");
  }

  if (facts.figures.length) {
    lines.push("Figures you may use, exactly as written:");
    for (const f of facts.figures.slice(0, 8)) lines.push(`  - ${f.value} — ${f.label}`);
  } else {
    lines.push("Figures: none available. Every number must be written as [ ].");
  }

  if (facts.notes) lines.push(`What the club says about itself:\n${facts.notes}`);

  return lines.join("\n");
}

// ── The schema, generated from the registry ───────────────────────────────────

function describeFields(fields: Fields, indent: string): string[] {
  const out: string[] = [];
  for (const [name, spec] of Object.entries(fields)) {
    switch (spec.kind) {
      case "text":
        out.push(`${indent}"${name}": string, max ${spec.max} chars — ${spec.label}`);
        break;
      case "url":
        out.push(`${indent}"${name}": a path like "/visit" or an https:// address — ${spec.label}`);
        break;
      case "enum":
        out.push(`${indent}"${name}": one of ${spec.values.map((v) => `"${v}"`).join(" | ")}`);
        break;
      case "int":
        out.push(`${indent}"${name}": number ${spec.min}–${spec.max}`);
        break;
      case "bool":
        out.push(`${indent}"${name}": true | false`);
        break;
      case "media":
        out.push(`${indent}"${name}": omit — you cannot choose photographs`);
        break;
      case "icon":
        out.push(`${indent}"${name}": an icon name (see the list above)`);
        break;
      case "list":
        out.push(`${indent}"${name}": array, at most ${spec.max}, each:`);
        out.push(...describeFields(spec.of, `${indent}    `));
        break;
    }
  }
  return out;
}

/**
 * The block schema as prose the model can follow.
 *
 * Built from BLOCKS rather than written by hand, so it cannot drift. The one
 * thing added by hand is the note on live blocks: a model that does not know
 * `meetings` fills itself in will helpfully type out four meetings it invented.
 */
export function blockSchemaPrompt(): string {
  const sections: string[] = [];
  // Widened to BlockDef: `as const satisfies` keeps each block's literal type,
  // which is what makes `BLOCKS.hero.fields.layout.values` narrow at call
  // sites — but it also means `once` is absent from the union rather than
  // optional. Iterating needs the interface.
  for (const [type, def] of Object.entries(BLOCKS) as [string, BlockDef][]) {
    const header = `- "${type}" — ${def.blurb}${
      def.live ? " THIS BLOCK FILLS ITSELF IN from the club's own records; give it only a heading and an intro, never any content." : ""
    }${def.once ? " At most one per page." : ""}`;
    sections.push([header, ...describeFields(def.fields, "    ")].join("\n"));
  }
  return sections.join("\n");
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SITE_RULES = `
You are drafting a page for a Rotary club's own website. A club officer will
read what you write, edit it, and decide whether to publish it. You are not
publishing anything.

Rules, in order of importance:
1. NEVER INVENT A FACT. You may use only what appears under FACTS below. If a
   sentence would be better with a number, a date, a name or a place you were
   not given, write [ ] there and carry on. A blank an officer fills in is
   fine. A plausible invention is not, and a club that finds one stops
   trusting everything else on the page.
2. Numbers are the dangerous case. Do not write "over 200 members", "thousands
   of hours" or "since the 1950s" unless that exact figure is in FACTS.
3. Write plainly. Short sentences. The reader is a neighbour deciding whether
   to visit, not a donor and not a Rotarian.
4. No marketing language, no urgency, no guilt, no flattery. Never imply
   somebody should feel bad for not joining.
5. Rotary is secular and non-political. No devotional language, no positions.
6. Sentence case for headings, not Title Case.
`.trim();

const PEOPLE_OF_ACTION_RULES = `
Rotary's public-image style, which you should follow:
${PEOPLE_OF_ACTION.structure.map((s) => `- ${s.step}: ${s.guidance}`).join("\n")}

Voice: ${BRAND_VOICE.traits.map((t) => `${t.key} (${t.note})`).join(" ")}

Avoid:
${PEOPLE_OF_ACTION.avoid.map((a) => `- ${a}`).join("\n")}
`.trim();

export interface PagePromptInput {
  facts: ClubFacts;
  /** What this page is for, in the officer's own words. */
  brief: string;
  /** The page's title, so the model knows what it is writing. */
  pageTitle: string;
  /** Slugs that exist, so links it writes go somewhere real. */
  existingSlugs: string[];
  /** The current content, when this is a rewrite rather than a first draft. */
  current?: Block[] | null;
}

export function pagePrompt(input: PagePromptInput): { system: string; user: string } {
  const links = input.existingSlugs.length
    ? input.existingSlugs.map((s) => (s ? `"/${s}"` : `"/" (home)`)).join(", ")
    : `"/" (home) only`;

  return {
    system: `${SITE_RULES}

${PEOPLE_OF_ACTION_RULES}

Return JSON and nothing else: an array of section objects, each with a "type"
and its fields. No prose before or after, no markdown fence.

Sections available:
${blockSchemaPrompt()}

Icon names you may use: ${BLOCK_ICONS.join(", ")}.

Links may only point at pages that exist: ${links}. Anything else must be an
https:// address you were given, or omitted.

A good page is six to nine sections. Start with a hero. Use the live blocks
("meetings", "projects", "officers") rather than writing that content yourself —
they read the club's real records and are never out of date.`,
    user: [
      `PAGE: ${input.pageTitle}`,
      `WHAT THIS PAGE IS FOR: ${input.brief || "The club's main page."}`,
      "",
      "FACTS:",
      factsBlock(input.facts),
      input.current?.length
        ? `\nThe page currently says this. Improve it; keep anything true and specific:\n${JSON.stringify(input.current).slice(0, 4000)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function brandPrompt(input: { facts: ClubFacts; brief: string }): { system: string; user: string } {
  return {
    system: `${SITE_RULES}

You are proposing a colour and type scheme for a Rotary club's website.

Rotary's palette, which you must choose from:
${ROTARY_COLOURS.map((c) => `- ${c.name} ${c.hex} (${c.role}) — ${c.use}`).join("\n")}

Royal Blue #17458f and Gold #f7a81b are the emblem colours and the safe answer.
A different pairing needs a reason from the club's own character — a water club
and turquoise, a Rotaract club and cranberry. Do not invent a hex code that is
not in the list above.

Ready-made schemes, if one already fits: ${BRAND_PRESETS.map((p) => `${p.key} (${p.name}: ${p.blurb})`).join("; ")}.

Return JSON and nothing else:
{
  "name": string, max 40 chars — what to call this scheme,
  "brandHex": "#rrggbb" from the palette above,
  "accentHex": "#rrggbb" from the palette above,
  "fontPair": "rotary" | "classic" | "modern" | "editorial",
  "radius": number 0-24 — 0 reads institutional, 16 reads friendly,
  "density": "airy" | "regular" | "compact",
  "voice": { "warmth": number 1-5, "note": string max 200 chars },
  "why": string, max 300 chars — one honest sentence on the choice
}`,
    user: [
      `WHAT THE CLUB SAID: ${input.brief || "No preference given."}`,
      "",
      "FACTS:",
      factsBlock(input.facts),
    ].join("\n"),
  };
}

export function polishPrompt(input: { text: string; intent: string; facts: ClubFacts }): {
  system: string;
  user: string;
} {
  return {
    system: `${SITE_RULES}

You are editing one passage a club officer already wrote. Keep their meaning and
every fact they included. Do not add facts. Do not make it longer. Return the
edited passage as plain text — no JSON, no markdown, no commentary.`,
    user: [
      `WHAT THEY WANT: ${input.intent || "Tighten it up."}`,
      "",
      `THEIR TEXT:\n${input.text.slice(0, 4000)}`,
      "",
      `Context, for checking facts only — do not add anything from here that they did not write:\n${factsBlock(input.facts)}`,
    ].join("\n"),
  };
}

// ── Reading what came back ────────────────────────────────────────────────────

/**
 * Pull JSON out of a model's answer.
 *
 * Told not to use a markdown fence, models use one anyway often enough that
 * refusing to cope is just a worse product. Falls back to the outermost
 * brace/bracket pair, which handles the "Here's your page:" preamble too.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to bracket matching */
  }

  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const start = candidate.indexOf(open);
    const end = candidate.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* try the other bracket kind */
      }
    }
  }
  return null;
}

/** Digit runs that look like a claim, e.g. "1,200" or "43". Not years. */
const FIGURE = /\b\d[\d,.]*\b/g;

/**
 * Strip figures the club never gave us.
 *
 * Belt and braces over rule 2 of the prompt. Models are good at this rule and
 * not perfect, and the failure is expensive in a specific way: a club puts
 * "over 3,000 volunteer hours" on their front page, a member notices it is
 * wrong, and the club concludes the software makes things up. One false figure
 * costs more trust than the whole feature earns.
 *
 * Anything numeric that is not in the supplied facts becomes `[ ]`, which the
 * editor highlights as needing a human. Years are left alone — a charter year
 * in the facts covers the case that matters, and blanking every four-digit
 * number would mangle "the 1985 project" into nonsense.
 */
export function scrubInvented(text: string, allowed: Set<string>): { text: string; removed: string[] } {
  const removed: string[] = [];
  const out = text.replace(FIGURE, (match) => {
    const bare = match.replace(/[,.]$/, "");
    if (allowed.has(bare) || allowed.has(bare.replace(/,/g, ""))) return match;
    // A plain four-digit year between 1850 and 2100 is almost always a date in
    // a sentence the officer will check anyway.
    if (/^\d{4}$/.test(bare)) {
      const year = Number(bare);
      if (year >= 1850 && year <= 2100) return match;
    }
    removed.push(match);
    return "[ ]";
  });
  return { text: out, removed };
}

/** Every figure the club gave us, in the forms a model might echo. */
export function allowedFigures(facts: ClubFacts): Set<string> {
  const allowed = new Set<string>();
  const add = (value: string) => {
    for (const m of value.matchAll(FIGURE)) {
      allowed.add(m[0]!);
      allowed.add(m[0]!.replace(/,/g, ""));
    }
  };
  for (const f of facts.figures) add(f.value);
  if (facts.charterYear) add(facts.charterYear);
  if (facts.meets) add(facts.meets);
  if (facts.location) add(facts.location);
  if (facts.notes) add(facts.notes);
  for (const p of facts.projects) {
    add(p.name);
    if (p.summary) add(p.summary);
  }
  return allowed;
}

/** Walk a block's string fields through the scrubber. */
function scrubBlocks(blocks: Block[], allowed: Set<string>): { blocks: Block[]; removed: string[] } {
  const removed: string[] = [];
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      const result = scrubInvented(value, allowed);
      removed.push(...result.removed);
      return result.text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = k === "id" || k === "type" ? v : walk(v);
      return out;
    }
    return value;
  };
  return { blocks: blocks.map((b) => walk(b) as Block), removed };
}

// ── Budget ────────────────────────────────────────────────────────────────────

/**
 * How many drafts a club may ask for in a day.
 *
 * Not about cost — a haiku-class call is fractions of a cent. It is about the
 * shape of the failure: a loop in a browser extension, or an officer who
 * discovers the button and holds it down, turning into a bill and a rate limit
 * that affects every other club. Generous enough that nobody legitimate meets
 * it, low enough that a runaway stops.
 */
export const DAILY_DRAFT_LIMIT = 60;

export async function withinBudget(db: TenantDb, today: string): Promise<boolean> {
  const used = await db.count("ai_invocations", {
    where: "created_at >= ? AND feature LIKE 'site_%'",
    params: [`${today}T00:00:00.000Z`],
  });
  return used < DAILY_DRAFT_LIMIT;
}

// ── The three calls ───────────────────────────────────────────────────────────

export interface PageProposal {
  ok: true;
  blocks: Block[];
  notes: ValidationNote[];
  /** Figures the model produced that we blanked. Shown to the officer. */
  blanked: string[];
}

export type ProposalResult<T> = T | { ok: false; message: string; configured: boolean };

const BUDGET_MESSAGE =
  "That's as many drafts as this club can ask for today. It resets at midnight — and everything you've already got is still here.";

export async function proposePage(
  env: AiEnv,
  db: TenantDb,
  input: PagePromptInput & { userId?: string | null; pageId: string; today: string },
  now: string,
): Promise<ProposalResult<PageProposal>> {
  if (!isConfigured(env)) return { ok: false, configured: false, message: NOT_CONFIGURED };
  if (!(await withinBudget(db, input.today))) {
    return { ok: false, configured: true, message: BUDGET_MESSAGE };
  }

  const prompt = pagePrompt(input);
  const result = await draft(
    env,
    db,
    {
      feature: "site_page",
      system: prompt.system,
      user: prompt.user,
      userId: input.userId ?? null,
      // Ids only. The prompt itself is reconstructible from the version and the
      // club's own record; the audit row does not need a copy of the club's
      // copy in it.
      inputRefs: { pageId: input.pageId, promptVersion: PROMPT_VERSION },
    },
    now,
  );

  if (!result.ok) return { ok: false, configured: result.configured, message: result.message };

  const parsed = extractJson(result.text);
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      configured: true,
      message: "The draft came back in a shape we couldn't read. Try again — it's usually fine the second time.",
    };
  }

  const validated = validateBlocks(parsed);
  const scrubbed = scrubBlocks(validated.blocks, allowedFigures(input.facts));

  return { ok: true, blocks: scrubbed.blocks, notes: validated.notes, blanked: scrubbed.removed };
}

export interface BrandProposal {
  ok: true;
  name: string;
  tokens: BrandTokens;
  why: string;
}

export async function proposeBrand(
  env: AiEnv,
  db: TenantDb,
  input: { facts: ClubFacts; brief: string; userId?: string | null; clubId: string; today: string },
  now: string,
): Promise<ProposalResult<BrandProposal>> {
  if (!isConfigured(env)) return { ok: false, configured: false, message: NOT_CONFIGURED };
  if (!(await withinBudget(db, input.today))) {
    return { ok: false, configured: true, message: BUDGET_MESSAGE };
  }

  const prompt = brandPrompt(input);
  const result = await draft(
    env,
    db,
    {
      feature: "site_brand",
      system: prompt.system,
      user: prompt.user,
      userId: input.userId ?? null,
      inputRefs: { clubId: input.clubId, promptVersion: PROMPT_VERSION },
    },
    now,
  );

  if (!result.ok) return { ok: false, configured: result.configured, message: result.message };

  const parsed = extractJson(result.text) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, configured: true, message: "That came back in a shape we couldn't read. Try again." };
  }

  return {
    ok: true,
    // validateTokens is the gate: a hex the model invented outside the palette
    // still has to be a hex, and anything else falls back to Royal Blue.
    tokens: validateTokens(parsed),
    name: String(parsed.name ?? "Proposed scheme").slice(0, 40),
    why: String(parsed.why ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
  };
}

export async function polish(
  env: AiEnv,
  db: TenantDb,
  input: { text: string; intent: string; facts: ClubFacts; userId?: string | null; today: string },
  now: string,
): Promise<AiResult> {
  if (!(await withinBudget(db, input.today))) {
    return { ok: false, configured: true, message: BUDGET_MESSAGE };
  }
  const prompt = polishPrompt(input);
  const result = await draft(
    env,
    db,
    {
      feature: "site_polish",
      system: prompt.system,
      user: prompt.user,
      userId: input.userId ?? null,
      inputRefs: { chars: input.text.length, promptVersion: PROMPT_VERSION },
    },
    now,
  );

  if (!result.ok) return result;
  // Same scrubbing as a page draft. "Tighten this up" is exactly the request
  // that tempts a model to sharpen a vague sentence into a specific claim.
  const { text } = scrubInvented(result.text, allowedFigures(input.facts));
  return { ...result, text };
}
