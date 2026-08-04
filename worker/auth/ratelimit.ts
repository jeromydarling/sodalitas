/**
 * ratelimit.ts — KV-backed rate limiting for public write paths.
 *
 * One rule governs everything in this file: **a broken limiter must never lock
 * anyone out.** If KV is slow, unavailable, or throwing, the request is
 * allowed. A rate limiter is a defence against abuse, not a load-bearing part
 * of sign-in — and a club secretary who can't log in because a cache is
 * unhappy will not care whose fault it was.
 *
 * We count failures, not attempts. Someone typing their own password correctly
 * fifty times is having a bad browser day, not attacking us.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Failures recorded in the current window. */
  count: number;
  /** Seconds until the window resets. Surfaced in Retry-After. */
  retryAfter: number;
  /** True when the limiter itself failed and we let the request through. */
  degraded: boolean;
}

export interface RateLimitRule {
  /** Window length in seconds. */
  windowSec: number;
  /** Failures permitted per window before blocking. */
  max: number;
}

/** The rules, in one place so they can be read at a glance and tested. */
export const RULES = {
  /** Sign-in, per email+IP. Generous — people mistype. */
  login: { windowSec: 900, max: 10 },
  /** Magic-link requests, per email. Each one sends mail. */
  magicLink: { windowSec: 900, max: 5 },
  /** Magic-link requests per IP, to stop someone spraying a member list. */
  magicLinkIp: { windowSec: 900, max: 20 },
  /** Password reset, per email. */
  passwordReset: { windowSec: 3600, max: 5 },
  /** Public join form, per IP per club. */
  joinForm: { windowSec: 3600, max: 8 },
  /** Public contact form, per IP. */
  contactForm: { windowSec: 3600, max: 5 },
  /**
   * Public donation checkout, per IP per club. Tighter than it looks generous,
   * because an unthrottled checkout endpoint is a free card-testing service
   * running on a club's own Stripe account — and it is the club, not us, that
   * would wear the disputes.
   */
  donate: { windowSec: 3600, max: 10 },
  /**
   * Booking an event place, per IP per club. Slightly looser than donations:
   * a family sharing a connection may genuinely book three or four times for
   * the same fundraiser, and a household that can't get a ticket is a worse
   * outcome than a card tester who gets twelve tries instead of ten.
   */
  register: { windowSec: 3600, max: 12 },
  /**
   * Entering the demo club, per IP. Generous — a curious visitor may open it
   * two or three times — but bounded, because every entry writes a session to
   * KV and an unthrottled session factory is a cheap way to fill it.
   */
  demoEnter: { windowSec: 3600, max: 20 },
} as const satisfies Record<string, RateLimitRule>;

export type RuleName = keyof typeof RULES;

function key(rule: string, subject: string): string {
  return `rl:${rule}:${subject}`;
}

interface Bucket {
  n: number;
  /** Epoch seconds when this window resets. */
  reset: number;
}

/**
 * Check whether a subject is currently blocked. Does not record anything —
 * call `recordFailure` after the attempt actually fails.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  rule: RuleName,
  subject: string,
): Promise<RateLimitResult> {
  const { windowSec, max } = RULES[rule];
  const now = Math.floor(Date.now() / 1000);
  try {
    const raw = await kv.get(key(rule, subject), "json") as Bucket | null;
    if (!raw || raw.reset <= now) {
      return { allowed: true, count: 0, retryAfter: 0, degraded: false };
    }
    const allowed = raw.n < max;
    return {
      allowed,
      count: raw.n,
      retryAfter: allowed ? 0 : Math.max(1, raw.reset - now),
      degraded: false,
    };
  } catch {
    // KV is unhappy. Let them through — see the note at the top of this file.
    return { allowed: true, count: 0, retryAfter: 0, degraded: true };
  }
}

/** Record one failed attempt. Safe to call without awaiting. */
export async function recordFailure(
  kv: KVNamespace,
  rule: RuleName,
  subject: string,
): Promise<void> {
  const { windowSec } = RULES[rule];
  const now = Math.floor(Date.now() / 1000);
  const k = key(rule, subject);
  try {
    const raw = (await kv.get(k, "json")) as Bucket | null;
    const bucket: Bucket =
      raw && raw.reset > now ? { n: raw.n + 1, reset: raw.reset } : { n: 1, reset: now + windowSec };
    // Expire the key a minute after the window closes so KV cleans up after us.
    await kv.put(k, JSON.stringify(bucket), {
      expirationTtl: Math.max(60, bucket.reset - now + 60),
    });
  } catch {
    // Losing a count is fine. Failing the request over it is not.
  }
}

/** Clear a subject's counter — call on a successful sign-in. */
export async function clearFailures(
  kv: KVNamespace,
  rule: RuleName,
  subject: string,
): Promise<void> {
  try {
    await kv.delete(key(rule, subject));
  } catch {
    /* best effort */
  }
}

/**
 * Check several rules at once and return the first block.
 * Used where both a per-email and a per-IP limit apply.
 */
export async function checkAll(
  kv: KVNamespace,
  checks: { rule: RuleName; subject: string }[],
): Promise<RateLimitResult> {
  const results = await Promise.all(checks.map((c) => checkRateLimit(kv, c.rule, c.subject)));
  const blocked = results.find((r) => !r.allowed);
  return blocked ?? results[0] ?? { allowed: true, count: 0, retryAfter: 0, degraded: false };
}
