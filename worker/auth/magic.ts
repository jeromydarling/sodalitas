/**
 * magic.ts — magic-link sign-in.
 *
 * This is the primary way into Sodalitas. Rotary clubs run on volunteers whose
 * term is one year; asking each of them to invent and remember a password for
 * a tool they open twice a month is how you end up with `Rotary2026!` on a
 * shared laptop. A link in their inbox is both easier and, in practice, safer.
 *
 * The link is:
 *   * high-entropy and random — never derived from the email,
 *   * stored only as a hash — the database cannot mint a working link,
 *   * single-use — consumed on first success, so a forwarded mail is inert,
 *   * short-lived — 60 minutes,
 *   * rate-limited per email and per IP,
 *   * silent about whether the address exists.
 *
 * That last point is the one people skip. "No account with that email" turns
 * a login form into a membership-list oracle: a competitor, or anyone with a
 * grievance, can test addresses one at a time and learn who belongs to a club.
 * So every request gets the same friendly answer, and mail is only sent when
 * there is somewhere to send it.
 */

import { hashToken, issueToken, normalizeEmail } from "./crypto";

const MAGIC_TTL_SEC = 60 * 60; // one hour

export type MagicPurpose = "login" | "invite" | "password_reset";

export interface MagicPayload {
  emailNorm: string;
  purpose: MagicPurpose;
  /** Tenant to land in, when the link came from a specific club's invitation. */
  tenantId: string | null;
  /** Where to go after sign-in. Validated as a same-site path before use. */
  redirectTo: string | null;
  createdAt: number;
}

function kvKey(tokenHash: string): string {
  return `magic:${tokenHash}`;
}

export interface IssueMagicInput {
  email: string;
  purpose?: MagicPurpose;
  tenantId?: string | null;
  redirectTo?: string | null;
}

/**
 * Mint a magic link token. Returns the raw token for the email body.
 *
 * Callers must have already decided the address is worth mailing — this
 * function does not check whether an account exists, precisely so the decision
 * and the "we've sent you a link" response stay independent.
 */
export async function issueMagicLink(
  env: { KV: KVNamespace },
  input: IssueMagicInput,
): Promise<{ token: string; expiresInSec: number }> {
  const { token, hash } = await issueToken();
  const payload: MagicPayload = {
    emailNorm: normalizeEmail(input.email),
    purpose: input.purpose ?? "login",
    tenantId: input.tenantId ?? null,
    redirectTo: safeRedirect(input.redirectTo ?? null),
    createdAt: Math.floor(Date.now() / 1000),
  };
  await env.KV.put(kvKey(hash), JSON.stringify(payload), { expirationTtl: MAGIC_TTL_SEC });
  return { token, expiresInSec: MAGIC_TTL_SEC };
}

/**
 * Consume a magic-link token. Deletes it first, then returns the payload — so
 * two clicks on the same link (mail scanners routinely fetch every URL in a
 * message) cannot both succeed.
 */
export async function consumeMagicLink(
  env: { KV: KVNamespace },
  token: string,
): Promise<MagicPayload | null> {
  if (!token || token.length < 20) return null;
  const hash = await hashToken(token);
  let payload: MagicPayload | null;
  try {
    payload = (await env.KV.get(kvKey(hash), "json")) as MagicPayload | null;
  } catch {
    return null;
  }
  if (!payload) return null;
  await env.KV.delete(kvKey(hash)).catch(() => {});

  // Belt and braces: KV's TTL should already have removed it.
  if (Math.floor(Date.now() / 1000) - payload.createdAt > MAGIC_TTL_SEC) return null;
  return payload;
}

/** Build the URL that goes in the email. */
export function magicLinkUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/auth/magic/${encodeURIComponent(token)}`;
}

/**
 * Only same-site absolute paths survive as redirect targets.
 *
 * `//evil.example` is a protocol-relative URL that browsers happily treat as
 * off-site, which is why checking for a leading `/` alone is not enough.
 */
export function safeRedirect(target: string | null): string | null {
  if (!target) return null;
  if (!target.startsWith("/")) return null;
  if (target.startsWith("//")) return null;
  if (target.includes("\\")) return null;
  if (/[\r\n]/.test(target)) return null;
  return target;
}

/**
 * The response every sign-in request gets, whether or not the address is known.
 * Kept here so it cannot drift apart from the code that decides to send.
 */
export const NEUTRAL_SIGNIN_MESSAGE =
  "If that address belongs to a member, a sign-in link is on its way. It's good for an hour.";
