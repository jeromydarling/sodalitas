/**
 * crypto.ts — password hashing and opaque tokens.
 *
 * Everything here uses WebCrypto, which Workers provides natively. No
 * dependencies, no Node polyfills, nothing that needs a build step.
 *
 * Two shapes of secret live in this app and they are handled differently:
 *
 *   Passwords     — PBKDF2-SHA256, per-user random salt, high iteration count.
 *                   Slow on purpose. Verified in constant time.
 *   Bearer tokens — magic links, invites, unsubscribe links. High-entropy
 *                   random values, stored only as a SHA-256 hash. We can check
 *                   a token someone presents; we can never reproduce one from
 *                   the database. A leaked backup is not a leaked mailbox.
 */

const PBKDF2_ITERATIONS = 210_000; // OWASP's 2023 floor for PBKDF2-SHA256
const SALT_BYTES = 16;
const KEY_BITS = 256;
const TOKEN_BYTES = 32; // 256 bits

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** URL-safe base64 without padding — safe in a path segment or query string. */
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Passwords ────────────────────────────────────────────────────────────────

export interface PasswordRecord {
  hash: string;
  salt: string;
}

async function derive(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
}

/** Hash a password for storage. Returns the hash and its salt, both hex. */
export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await derive(password, salt);
  return { hash: toHex(bits), salt: toHex(salt) };
}

/**
 * Verify a password against a stored record.
 *
 * Returns false for a user who has no password set — that is the normal state
 * for magic-link accounts, not an error. We still burn the same work either
 * way so the response time doesn't reveal which accounts have passwords.
 */
export async function verifyPassword(
  password: string,
  record: { hash: string | null; salt: string | null },
): Promise<boolean> {
  if (!record.hash || !record.salt) {
    // Dummy derivation so a passwordless account costs the same as a real one.
    await derive(password, crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
    return false;
  }
  const bits = await derive(password, fromHex(record.salt));
  return timingSafeEqual(toHex(bits), record.hash);
}

/** Compare two hex strings without leaking where they diverge. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Password rules, kept deliberately unfussy. Length is what matters; forcing a
 * punctuation mark just produces `Password1!` on a sticky note. We reject the
 * handful of passwords that are genuinely everybody's.
 */
const COMMON = new Set([
  "password", "12345678", "123456789", "qwertyuiop", "password1", "password123",
  "letmein1", "iloveyou", "welcome1", "rotary123", "sodalitas",
]);

export function validatePassword(password: string): { ok: true } | { ok: false; message: string } {
  if (password.length < 10) {
    return { ok: false, message: "Passwords need to be at least 10 characters. Length beats punctuation." };
  }
  if (password.length > 200) {
    return { ok: false, message: "That password is longer than we can store — 200 characters is the limit." };
  }
  if (COMMON.has(password.toLowerCase())) {
    return { ok: false, message: "That one's on every guessing list there is. Try something only you'd pick." };
  }
  return { ok: true };
}

// ── Bearer tokens ────────────────────────────────────────────────────────────

export interface IssuedToken {
  /** Give this to the human. It is never stored. */
  token: string;
  /** Store this. It cannot be turned back into the token. */
  hash: string;
}

/** Mint a high-entropy token and its storage hash. */
export async function issueToken(): Promise<IssuedToken> {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  const token = toBase64Url(bytes);
  return { token, hash: await hashToken(token) };
}

/** Hash a presented token so it can be looked up against stored hashes. */
export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(token)));
}

/**
 * Hash an IP for rate-limit keys and audit rows.
 *
 * Salted with a server secret so the stored value can't be reversed by hashing
 * the whole IPv4 space — which takes about a second, and is exactly what makes
 * an unsalted "anonymised" IP not anonymous at all.
 */
export async function hashIp(ip: string, secret: string): Promise<string> {
  return (await hashToken(`${secret}:${ip}`)).slice(0, 32);
}

/** Normalise an email for use as a lookup key. The stored key, not the display value. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Is this plausibly an email address?
 *
 * Deliberately permissive: the only real test is whether mail arrives, and a
 * clever regex mostly succeeds at rejecting people with unusual but valid
 * addresses. We check for the shape and let delivery be the judge.
 */
export function looksLikeEmail(email: string): boolean {
  const e = email.trim();
  if (e.length < 6 || e.length > 254) return false;
  const at = e.indexOf("@");
  if (at < 1 || at !== e.lastIndexOf("@")) return false;
  const domain = e.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return !/\s/.test(e);
}
