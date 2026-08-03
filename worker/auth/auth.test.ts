/**
 * auth.test.ts — crypto, rate limiting, sessions, magic links.
 *
 * These run against real WebCrypto (Node 22 has it globally) and a fake KV, so
 * the hashing and token behaviour under test is the behaviour that ships.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  hashPassword, verifyPassword, validatePassword, timingSafeEqual,
  issueToken, hashToken, hashIp, normalizeEmail, looksLikeEmail,
} from "./crypto";
import { checkRateLimit, recordFailure, clearFailures, checkAll, RULES } from "./ratelimit";
import {
  createSession, readSession, destroySession, destroyAllUserSessions,
  setSessionTenant, sessionCookie, clearCookie, readCookie, SESSION_COOKIE,
  shouldUseSecureCookie,
} from "./session";
import { issueMagicLink, consumeMagicLink, safeRedirect, magicLinkUrl } from "./magic";

// ── Fakes ────────────────────────────────────────────────────────────────────

function fakeKV() {
  const store = new Map<string, string>();
  let failing = false;
  const kv = {
    async get(key: string, type?: string) {
      if (failing) throw new Error("KV unavailable");
      const v = store.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      if (failing) throw new Error("KV unavailable");
      store.set(key, value);
    },
    async delete(key: string) {
      if (failing) throw new Error("KV unavailable");
      store.delete(key);
    },
  };
  return {
    kv: kv as unknown as KVNamespace,
    store,
    fail: (v: boolean) => { failing = v; },
  };
}

function fakeDB() {
  const sessions: Record<string, unknown>[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              if (sql.startsWith("INSERT INTO sessions")) {
                sessions.push({ id: params[0], user_id: params[1], tenant_id: params[2] });
              } else if (sql.startsWith("DELETE FROM sessions WHERE user_id")) {
                for (let i = sessions.length - 1; i >= 0; i--) {
                  if (sessions[i]!.user_id === params[0]) sessions.splice(i, 1);
                }
              } else if (sql.startsWith("DELETE FROM sessions WHERE id")) {
                const i = sessions.findIndex((s) => s.id === params[0]);
                if (i >= 0) sessions.splice(i, 1);
              } else if (sql.startsWith("UPDATE sessions SET tenant_id")) {
                const s = sessions.find((x) => x.id === params[1]);
                if (s) s.tenant_id = params[0];
              }
              return { meta: { changes: 1 } };
            },
            async all() {
              if (sql.includes("FROM sessions WHERE user_id")) {
                return { results: sessions.filter((s) => s.user_id === params[0]).map((s) => ({ id: s.id })) };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, sessions };
}

// ── Passwords ────────────────────────────────────────────────────────────────

describe("password hashing", () => {
  it("round-trips a correct password", async () => {
    const rec = await hashPassword("a quiet thursday lunch");
    expect(await verifyPassword("a quiet thursday lunch", rec)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const rec = await hashPassword("a quiet thursday lunch");
    expect(await verifyPassword("a quiet thursday lunc", rec)).toBe(false);
  });

  it("salts, so the same password hashes differently for two people", async () => {
    const a = await hashPassword("service above self");
    const b = await hashPassword("service above self");
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it("stores nothing resembling the password", async () => {
    const rec = await hashPassword("service above self");
    expect(rec.hash).not.toContain("service");
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns false — not an error — for an account with no password set", async () => {
    expect(await verifyPassword("anything", { hash: null, salt: null })).toBe(false);
  });

  it("handles unicode and very long passphrases", async () => {
    const pw = "ロータリー 奉仕の理想 " + "x".repeat(150);
    const rec = await hashPassword(pw);
    expect(await verifyPassword(pw, rec)).toBe(true);
  });
});

describe("password rules", () => {
  it("asks for length rather than punctuation theatre", () => {
    expect(validatePassword("short").ok).toBe(false);
    expect(validatePassword("nine char").ok).toBe(false);
    expect(validatePassword("ten chars!").ok).toBe(true);
    expect(validatePassword("four words strung together").ok).toBe(true);
  });

  it("turns away the passwords everybody uses", () => {
    for (const p of ["password123", "PASSWORD123", "rotary123", "qwertyuiop"]) {
      expect(validatePassword(p).ok, p).toBe(false);
    }
  });

  it("explains itself kindly and without blame", () => {
    const r = validatePassword("short");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/[a-z]/);
      expect(r.message).not.toMatch(/invalid|error|failed|must not/i);
    }
  });

  it("refuses a password too long to store", () => {
    expect(validatePassword("x".repeat(201)).ok).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("compares equal and unequal strings correctly", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

// ── Tokens ───────────────────────────────────────────────────────────────────

describe("tokens", () => {
  it("issues a URL-safe token and a hash that isn't the token", async () => {
    const { token, hash } = await issueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("never repeats", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add((await issueToken()).token);
    expect(seen.size).toBe(200);
  });

  it("hashes a presented token to the stored value", async () => {
    const { token, hash } = await issueToken();
    expect(await hashToken(token)).toBe(hash);
  });

  it("salts IP hashes, so the same IP differs across deployments", async () => {
    const a = await hashIp("203.0.113.7", "secret-one");
    const b = await hashIp("203.0.113.7", "secret-two");
    expect(a).not.toBe(b);
    expect(await hashIp("203.0.113.7", "secret-one")).toBe(a);
  });
});

describe("email handling", () => {
  it("normalises for lookup", () => {
    expect(normalizeEmail("  President@Club.ORG ")).toBe("president@club.org");
  });

  it("accepts addresses that are unusual but real", () => {
    for (const e of [
      "a.b+rotary@example.co.uk",
      "president@rotary-duluth.org",
      "o'brien@example.com",
      "член@пример.рф",
    ]) {
      expect(looksLikeEmail(e), e).toBe(true);
    }
  });

  it("rejects things that are not addresses", () => {
    for (const e of ["", "nope", "a@b", "two@at@signs.com", "has space@x.com", "@x.com", "a@.com"]) {
      expect(looksLikeEmail(e), e).toBe(false);
    }
  });
});

// ── Rate limiting ────────────────────────────────────────────────────────────

describe("rate limiting", () => {
  let f: ReturnType<typeof fakeKV>;
  beforeEach(() => { f = fakeKV(); });

  it("allows a subject with no history", async () => {
    const r = await checkRateLimit(f.kv, "login", "a@b.com|1.2.3.4");
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(0);
  });

  it("blocks only after the limit is exceeded", async () => {
    const subject = "a@b.com|1.2.3.4";
    for (let i = 0; i < RULES.login.max; i++) {
      expect((await checkRateLimit(f.kv, "login", subject)).allowed).toBe(true);
      await recordFailure(f.kv, "login", subject);
    }
    const blocked = await checkRateLimit(f.kv, "login", subject);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts each subject separately", async () => {
    for (let i = 0; i < RULES.login.max; i++) await recordFailure(f.kv, "login", "one");
    expect((await checkRateLimit(f.kv, "login", "one")).allowed).toBe(false);
    expect((await checkRateLimit(f.kv, "login", "two")).allowed).toBe(true);
  });

  it("clears on a successful sign-in", async () => {
    for (let i = 0; i < RULES.login.max; i++) await recordFailure(f.kv, "login", "s");
    expect((await checkRateLimit(f.kv, "login", "s")).allowed).toBe(false);
    await clearFailures(f.kv, "login", "s");
    expect((await checkRateLimit(f.kv, "login", "s")).allowed).toBe(true);
  });

  it("forgets a window that has expired", async () => {
    const subject = "s";
    for (let i = 0; i < RULES.login.max; i++) await recordFailure(f.kv, "login", subject);
    expect((await checkRateLimit(f.kv, "login", subject)).allowed).toBe(false);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (RULES.login.windowSec + 1) * 1000);
    expect((await checkRateLimit(f.kv, "login", subject)).allowed).toBe(true);
    vi.useRealTimers();
  });

  // The property that matters most in this file.
  it("FAILS OPEN when KV is broken — a bad cache must never lock a club out", async () => {
    for (let i = 0; i < RULES.login.max * 3; i++) await recordFailure(f.kv, "login", "s");
    expect((await checkRateLimit(f.kv, "login", "s")).allowed).toBe(false);

    f.fail(true);
    const r = await checkRateLimit(f.kv, "login", "s");
    expect(r.allowed).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it("swallows KV errors while recording, rather than failing the request", async () => {
    f.fail(true);
    await expect(recordFailure(f.kv, "login", "s")).resolves.toBeUndefined();
    await expect(clearFailures(f.kv, "login", "s")).resolves.toBeUndefined();
  });

  it("checkAll reports the first rule that blocks", async () => {
    for (let i = 0; i < RULES.magicLink.max; i++) await recordFailure(f.kv, "magicLink", "a@b.com");
    const r = await checkAll(f.kv, [
      { rule: "magicLink", subject: "a@b.com" },
      { rule: "magicLinkIp", subject: "1.2.3.4" },
    ]);
    expect(r.allowed).toBe(false);
  });

  it("keeps magic-link limits tighter than login limits, since each one sends mail", () => {
    expect(RULES.magicLink.max).toBeLessThan(RULES.login.max);
  });
});

// ── Sessions ─────────────────────────────────────────────────────────────────

describe("sessions", () => {
  let kvf: ReturnType<typeof fakeKV>;
  let dbf: ReturnType<typeof fakeDB>;
  let env: { KV: KVNamespace; DB: D1Database };

  beforeEach(() => {
    kvf = fakeKV();
    dbf = fakeDB();
    env = { KV: kvf.kv, DB: dbf.db };
  });

  it("creates a session that reads back", async () => {
    const { token, data } = await createSession(env, { userId: "us_1", tenantId: "tn_1" });
    const read = await readSession(env, token);
    expect(read?.userId).toBe("us_1");
    expect(read?.tenantId).toBe("tn_1");
    expect(read?.sessionId).toBe(data.sessionId);
  });

  it("stores the token only as a hash — the cookie value never appears in KV", async () => {
    const { token } = await createSession(env, { userId: "us_1", tenantId: null });
    for (const key of kvf.store.keys()) expect(key).not.toContain(token);
    for (const value of kvf.store.values()) expect(value).not.toContain(token);
  });

  it("returns null for a token nobody issued", async () => {
    await createSession(env, { userId: "us_1", tenantId: null });
    expect(await readSession(env, "not-a-real-token-value-at-all")).toBeNull();
    expect(await readSession(env, null)).toBeNull();
  });

  it("refuses an expired session", async () => {
    const { token } = await createSession(env, { userId: "us_1", tenantId: null });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 24 * 3600 * 1000);
    expect(await readSession(env, token)).toBeNull();
    vi.useRealTimers();
  });

  // Unlike the rate limiter, this one fails closed on purpose.
  it("FAILS CLOSED when KV is broken — an unidentifiable request is anonymous", async () => {
    const { token } = await createSession(env, { userId: "us_1", tenantId: null });
    kvf.fail(true);
    expect(await readSession(env, token)).toBeNull();
  });

  it("switches tenant without re-authenticating", async () => {
    const { token, data } = await createSession(env, { userId: "us_1", tenantId: "tn_1" });
    await setSessionTenant(env, token, data, "tn_2");
    expect((await readSession(env, token))?.tenantId).toBe("tn_2");
  });

  it("ends one session", async () => {
    const { token } = await createSession(env, { userId: "us_1", tenantId: null });
    await destroySession(env, token);
    expect(await readSession(env, token)).toBeNull();
  });

  it("ends every session a user holds — removal from a club takes effect at once", async () => {
    const a = await createSession(env, { userId: "us_1", tenantId: "tn_1" });
    const b = await createSession(env, { userId: "us_1", tenantId: "tn_1" });
    const other = await createSession(env, { userId: "us_2", tenantId: "tn_1" });

    const ended = await destroyAllUserSessions(env, "us_1");
    expect(ended).toBe(2);
    expect(await readSession(env, a.token)).toBeNull();
    expect(await readSession(env, b.token)).toBeNull();
    // Somebody else's session is untouched.
    expect(await readSession(env, other.token)).not.toBeNull();
  });

  it("survives a failed shadow write — the session still works", async () => {
    const broken = {
      prepare: () => ({ bind: () => ({ run: async () => { throw new Error("D1 down"); } }) }),
    } as unknown as D1Database;
    const { token } = await createSession({ KV: kvf.kv, DB: broken }, { userId: "us_1", tenantId: null });
    expect((await readSession({ KV: kvf.kv }, token))?.userId).toBe("us_1");
  });
});

describe("session cookie", () => {
  it("is HttpOnly, Secure and SameSite=Lax", () => {
    const c = sessionCookie("tok");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    // Lax, not Strict: a magic link arrives as a cross-site top-level
    // navigation from the mail client, and Strict would drop the cookie there.
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Path=/");
  });

  it("drops Secure for local dev, where there's no TLS", () => {
    expect(sessionCookie("tok", { secure: false })).not.toContain("Secure");
  });

  it("clears with Max-Age=0", () => {
    expect(clearCookie()).toContain("Max-Age=0");
  });

  // Derived from the request, not from config: `wrangler dev` serves the
  // production vars block, so APP_ENV reads "production" on localhost. A Secure
  // cookie over plain http is dropped silently, and "sign-in works but I'm
  // still logged out" is an hour of debugging to trace back to one flag.
  it("decides Secure from the request rather than an env var", () => {
    const req = (url: string) => new Request(url);
    expect(shouldUseSecureCookie(req("http://localhost:5173/login"))).toBe(false);
    expect(shouldUseSecureCookie(req("http://127.0.0.1:8787/login"))).toBe(false);
    expect(shouldUseSecureCookie(req("https://localhost:5173/login"))).toBe(true);
    expect(shouldUseSecureCookie(req("https://sodalitas.app/login"))).toBe(true);
    // A non-loopback host over plain http is somebody's staging box, and it
    // still gets the stricter flag.
    expect(shouldUseSecureCookie(req("http://staging.internal/login"))).toBe(true);
  });

  it("reads one cookie out of a header without matching a prefix", () => {
    const header = `other=1; ${SESSION_COOKIE}=abc123; ${SESSION_COOKIE}_other=nope`;
    expect(readCookie(header, SESSION_COOKIE)).toBe("abc123");
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
    expect(readCookie("nothing=here", SESSION_COOKIE)).toBeNull();
  });
});

// ── Magic links ──────────────────────────────────────────────────────────────

describe("magic links", () => {
  let f: ReturnType<typeof fakeKV>;
  let env: { KV: KVNamespace };
  beforeEach(() => { f = fakeKV(); env = { KV: f.kv }; });

  it("issues a token that consumes to its payload", async () => {
    const { token } = await issueMagicLink(env, { email: "  Sec@Club.org ", tenantId: "tn_1" });
    const payload = await consumeMagicLink(env, token);
    expect(payload?.emailNorm).toBe("sec@club.org");
    expect(payload?.tenantId).toBe("tn_1");
    expect(payload?.purpose).toBe("login");
  });

  it("is single-use — a mail scanner following the link can't burn it for the member twice", async () => {
    const { token } = await issueMagicLink(env, { email: "a@b.com" });
    expect(await consumeMagicLink(env, token)).not.toBeNull();
    expect(await consumeMagicLink(env, token)).toBeNull();
  });

  it("stores no trace of the token itself", async () => {
    const { token } = await issueMagicLink(env, { email: "a@b.com" });
    for (const k of f.store.keys()) expect(k).not.toContain(token);
    for (const v of f.store.values()) expect(v).not.toContain(token);
  });

  it("rejects a token nobody issued", async () => {
    expect(await consumeMagicLink(env, "made-up-token-that-is-long-enough")).toBeNull();
    expect(await consumeMagicLink(env, "")).toBeNull();
    expect(await consumeMagicLink(env, "short")).toBeNull();
  });

  it("expires after an hour", async () => {
    const { token } = await issueMagicLink(env, { email: "a@b.com" });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61 * 60 * 1000);
    expect(await consumeMagicLink(env, token)).toBeNull();
    vi.useRealTimers();
  });

  it("gives two requests for the same address different tokens", async () => {
    const a = await issueMagicLink(env, { email: "a@b.com" });
    const b = await issueMagicLink(env, { email: "a@b.com" });
    expect(a.token).not.toBe(b.token);
    // Both are live; the member may have requested twice and will click either.
    expect(await consumeMagicLink(env, a.token)).not.toBeNull();
    expect(await consumeMagicLink(env, b.token)).not.toBeNull();
  });

  it("builds a link against the app URL, trailing slash or not", async () => {
    expect(magicLinkUrl("https://sodalitas.app/", "tok")).toBe("https://sodalitas.app/auth/magic/tok");
    expect(magicLinkUrl("https://sodalitas.app", "a/b")).toBe("https://sodalitas.app/auth/magic/a%2Fb");
  });
});

describe("safeRedirect", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirect("/app/people")).toBe("/app/people");
    expect(safeRedirect("/app/people?q=1")).toBe("/app/people?q=1");
  });

  it("drops anything that could leave the site", () => {
    for (const t of [
      "https://evil.example",
      "//evil.example",           // protocol-relative — a browser treats this as off-site
      "\\\\evil.example",
      "javascript:alert(1)",
      "app/people",               // relative, could resolve anywhere
      "/app\\..\\evil",
      "/app\r\nSet-Cookie: x=1",  // header injection
    ]) {
      expect(safeRedirect(t), t).toBeNull();
    }
    expect(safeRedirect(null)).toBeNull();
  });
});
