/**
 * provider.ts — the AI abstraction.
 *
 * Three rules, none of them negotiable:
 *
 *   **AI drafts; a human sends.** Nothing here writes to a member's record,
 *   emails anybody, or changes a score. Every call returns text for a person to
 *   read, edit and approve. A tool that emails a Rotarian on its own is a tool
 *   a club switches off after the first mistake.
 *
 *   **It never invents a fact.** Prompts pass the club's real numbers and
 *   instruct the model to leave a marked blank rather than guess. An invented
 *   attendance figure in a district report is worse than no report.
 *
 *   **It degrades dark.** With no key, every call returns `configured: false`
 *   and a friendly line. The product is fully usable without AI — this is the
 *   garnish, not the meal.
 *
 * Server-only. The Anthropic SDK is externalised from the client bundle in
 * vite.config.ts; importing this file from a component would drag it in.
 */

import { newId } from "@domain/ids";
import type { TenantDb } from "@db/scope";

/** Bumped whenever a prompt changes, and stored with every invocation. */
export const PROMPT_VERSION = "2026-08-03.1";

export type AiFeature =
  | "meeting_recap"
  | "followup_draft"
  | "checkin_draft"
  | "risk_explanation";

export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
}

export type AiResult =
  | { ok: true; text: string; provider: "anthropic" | "workers_ai"; model: string }
  | { ok: false; configured: boolean; message: string };

/**
 * Anthropic's current small model. Drafting a three-line note to a member is
 * not a frontier-model problem, and the cheaper tier keeps this affordable for
 * a club paying $59 a month.
 */
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
/** Workers AI fallback, used only when it is bound and Anthropic is not. */
const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const MAX_TOKENS = 700;
const TIMEOUT_MS = 20_000;

export function isConfigured(env: AiEnv): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.AI);
}

/** The line shown wherever an AI feature would be, when there's no key. */
export const NOT_CONFIGURED =
  "Drafting isn't switched on for this club. Everything else works — this button just writes a first draft for you to edit.";

/**
 * Ask for a draft.
 *
 * Records the invocation, including the prompt version and model, so a club can
 * always see what produced a piece of text and whether a human accepted it.
 */
export async function draft(
  env: AiEnv,
  db: TenantDb | null,
  input: {
    feature: AiFeature;
    system: string;
    user: string;
    userId?: string | null;
    /** Ids only — never raw member data. This ends up in an audit row. */
    inputRefs?: Record<string, unknown>;
  },
  now: string,
): Promise<AiResult> {
  if (!isConfigured(env)) {
    return { ok: false, configured: false, message: NOT_CONFIGURED };
  }

  const started = Date.now();
  let result: AiResult;

  try {
    result = env.ANTHROPIC_API_KEY
      ? await callAnthropic(env.ANTHROPIC_API_KEY, input.system, input.user)
      : await callWorkersAi(env.AI!, input.system, input.user);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ai:${input.feature}]`, message);
    result = {
      ok: false,
      configured: true,
      // Never surface a provider error to a club officer. They cannot act on
      // it, and it reads like the product is broken when it isn't.
      message: "The drafting service didn't answer just now. Try again in a moment.",
    };
  }

  if (db) {
    // Auditing must not be able to fail the request it is auditing.
    try {
      await db.insert("ai_invocations", {
        id: newId("aiInvocation"),
        user_id: input.userId ?? null,
        feature: input.feature,
        prompt_version: PROMPT_VERSION,
        provider: env.ANTHROPIC_API_KEY ? "anthropic" : "workers_ai",
        model: env.ANTHROPIC_API_KEY ? ANTHROPIC_MODEL : WORKERS_AI_MODEL,
        input_refs: JSON.stringify({ ...input.inputRefs, ms: Date.now() - started }),
        output: result.ok ? result.text : null,
        // Null until a human accepts or discards it. That is the number worth
        // watching: drafts nobody uses are drafts we should stop making.
        accepted: null,
        error: result.ok ? null : result.message,
        created_at: now,
      });
    } catch (err) {
      console.error("[ai] could not record invocation", err);
    }
  }

  return result;
}

async function callAnthropic(apiKey: string, system: string, user: string): Promise<AiResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  if (!text) throw new Error("Empty response");
  return { ok: true, text, provider: "anthropic", model: ANTHROPIC_MODEL };
}

async function callWorkersAi(
  ai: NonNullable<AiEnv["AI"]>,
  system: string,
  user: string,
): Promise<AiResult> {
  const out = (await ai.run(WORKERS_AI_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: MAX_TOKENS,
  })) as { response?: string };

  const text = (out.response ?? "").trim();
  if (!text) throw new Error("Empty response");
  return { ok: true, text, provider: "workers_ai", model: WORKERS_AI_MODEL };
}

/** Record whether a human used what was drafted. */
export async function recordVerdict(
  db: TenantDb,
  invocationId: string,
  accepted: boolean,
): Promise<void> {
  await db.update("ai_invocations", invocationId, { accepted: accepted ? 1 : 0 });
}
