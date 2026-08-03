/**
 * session.ts — sessions in KV, with a D1 shadow for revocation and visibility.
 *
 * KV is the read path: every request resolves its session with one KV get,
 * which is fast and close to the eyeball. D1 holds a shadow row so that
 * "sign this person out everywhere" is one indexed DELETE, and so a club admin
 * can see and end active sessions.
 *
 * The cookie carries an opaque token, never a JWT. Nothing about who you are
 * travels in it, and revocation is immediate rather than "immediate once the
 * token expires" — which matters when a club removes someone mid-year.
 */

import { newId } from "@domain/ids";
import { hashToken, issueToken } from "./crypto";

export const SESSION_COOKIE = "sod_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
/** Refresh the sliding window once a session is more than a day old. */
const REFRESH_AFTER_SEC = 60 * 60 * 24;

export interface SessionData {
  sessionId: string;
  userId: string;
  /** The tenant this session is currently working in. */
  tenantId: string | null;
  createdAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
}

function kvKey(tokenHash: string): string {
  return `sess:${tokenHash}`;
}

// ── Creating and ending sessions ─────────────────────────────────────────────

export interface CreateSessionInput {
  userId: string;
  tenantId: string | null;
  userAgent?: string | null;
  ipHash?: string | null;
}

/** Start a session. Returns the raw token to put in the cookie. */
export async function createSession(
  env: { KV: KVNamespace; DB: D1Database },
  input: CreateSessionInput,
): Promise<{ token: string; data: SessionData }> {
  const { token, hash } = await issueToken();
  const now = Math.floor(Date.now() / 1000);
  const data: SessionData = {
    sessionId: newId("session"),
    userId: input.userId,
    tenantId: input.tenantId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_SEC,
  };

  await env.KV.put(kvKey(hash), JSON.stringify(data), { expirationTtl: SESSION_TTL_SEC });

  // Shadow row. The token hash is stored so revoking by session id can also
  // clear KV. If this write fails the session still works — losing the shadow
  // costs us visibility, not correctness.
  try {
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, tenant_id, user_agent, ip_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        data.sessionId,
        input.userId,
        input.tenantId,
        input.userAgent?.slice(0, 300) ?? null,
        input.ipHash ?? null,
        new Date(data.expiresAt * 1000).toISOString(),
        new Date(now * 1000).toISOString(),
      )
      .run();
    await env.KV.put(`sessidx:${data.sessionId}`, hash, { expirationTtl: SESSION_TTL_SEC });
  } catch {
    /* shadow is best-effort */
  }

  return { token, data };
}

/** Resolve a session from a raw cookie token. Returns null when absent or expired. */
export async function readSession(
  env: { KV: KVNamespace },
  token: string | null,
): Promise<SessionData | null> {
  if (!token) return null;
  const hash = await hashToken(token);
  let data: SessionData | null;
  try {
    data = (await env.KV.get(kvKey(hash), "json")) as SessionData | null;
  } catch {
    // KV unavailable. Unlike rate limiting, this one fails *closed*: we cannot
    // establish who someone is, so they are nobody.
    return null;
  }
  if (!data) return null;
  if (data.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return data;
}

/**
 * Extend a session's window if it is old enough to be worth a write. Returns
 * true when it refreshed, so the caller knows to re-set the cookie.
 */
export async function touchSession(
  env: { KV: KVNamespace; DB: D1Database },
  token: string,
  data: SessionData,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (data.expiresAt - now > SESSION_TTL_SEC - REFRESH_AFTER_SEC) return false;
  const hash = await hashToken(token);
  const next: SessionData = { ...data, expiresAt: now + SESSION_TTL_SEC };
  try {
    await env.KV.put(kvKey(hash), JSON.stringify(next), { expirationTtl: SESSION_TTL_SEC });
    await env.DB.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`)
      .bind(new Date(next.expiresAt * 1000).toISOString(), data.sessionId)
      .run();
  } catch {
    return false;
  }
  return true;
}

/** Switch which tenant a session is working in, without re-authenticating. */
export async function setSessionTenant(
  env: { KV: KVNamespace; DB: D1Database },
  token: string,
  data: SessionData,
  tenantId: string,
): Promise<SessionData> {
  const hash = await hashToken(token);
  const next: SessionData = { ...data, tenantId };
  const ttl = Math.max(60, next.expiresAt - Math.floor(Date.now() / 1000));
  await env.KV.put(kvKey(hash), JSON.stringify(next), { expirationTtl: ttl });
  try {
    await env.DB.prepare(`UPDATE sessions SET tenant_id = ? WHERE id = ?`)
      .bind(tenantId, data.sessionId)
      .run();
  } catch {
    /* shadow is best-effort */
  }
  return next;
}

/** End one session. */
export async function destroySession(
  env: { KV: KVNamespace; DB: D1Database },
  token: string,
): Promise<void> {
  const hash = await hashToken(token);
  const data = (await env.KV.get(kvKey(hash), "json").catch(() => null)) as SessionData | null;
  await env.KV.delete(kvKey(hash)).catch(() => {});
  if (data) {
    await env.KV.delete(`sessidx:${data.sessionId}`).catch(() => {});
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(data.sessionId).run().catch(() => {});
  }
}

/**
 * End every session a user holds, everywhere.
 *
 * Called when someone is removed from a club, when a password changes, and
 * when an admin ends a session by hand. This is the reason for the shadow
 * table: without it there is no way to enumerate a user's KV keys.
 */
export async function destroyAllUserSessions(
  env: { KV: KVNamespace; DB: D1Database },
  userId: string,
): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT id FROM sessions WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string }>();
  const ids = results ?? [];

  await Promise.all(
    ids.map(async ({ id }) => {
      const hash = await env.KV.get(`sessidx:${id}`).catch(() => null);
      if (hash) await env.KV.delete(kvKey(hash)).catch(() => {});
      await env.KV.delete(`sessidx:${id}`).catch(() => {});
    }),
  );

  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
  return ids.length;
}

// ── Cookies ──────────────────────────────────────────────────────────────────

export interface CookieOptions {
  /** Off in local dev, where there is no TLS. */
  secure?: boolean;
}

export function sessionCookie(token: string, opts: CookieOptions = {}): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    // Lax, not Strict: a magic link arrives from a mail client as a top-level
    // navigation, and Strict would drop the cookie on exactly that hop.
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SEC}`,
  ];
  if (opts.secure !== false) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(opts: CookieOptions = {}): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (opts.secure !== false) parts.push("Secure");
  return parts.join("; ");
}

/** Pull one cookie out of a Cookie header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export function sessionTokenFrom(request: Request): string | null {
  return readCookie(request.headers.get("Cookie"), SESSION_COOKIE);
}
