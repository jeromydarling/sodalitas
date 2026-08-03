/**
 * api.ts — the JSON API, mounted at /api/*.
 *
 * Hono handles routing; every handler resolves its caller through the shared
 * request context so auth and tenant scoping are the same here as in a loader.
 */

import { Hono } from "hono";
import { getContext, clientIp, Unauthenticated, NoTenant, type Env } from "./context";
import { Forbidden } from "@domain/roles";
import { ScopeError } from "@db/scope";
import { checkRateLimit, recordFailure } from "./auth/ratelimit";
import { hashIp } from "./auth/crypto";
import { newId } from "@domain/ids";

export const api = new Hono<{ Bindings: Env }>().basePath("/api");

/**
 * One error shape for everything.
 *
 * Client errors say what to do; server errors don't leak internals. A Forbidden
 * names the capability, because "you can't do that" without saying which
 * permission is missing turns into a support email every time.
 */
api.onError((err, c) => {
  if (err instanceof Unauthenticated) {
    return c.json({ error: "unauthenticated", message: "Sign in to continue." }, 401);
  }
  if (err instanceof NoTenant) {
    return c.json({ error: "no_tenant", message: "Choose a club or district first." }, 400);
  }
  if (err instanceof Forbidden) {
    return c.json(
      {
        error: "forbidden",
        message: "Your role in this club doesn't include that. A club president or administrator can change it in Settings.",
        capability: err.cap,
      },
      403,
    );
  }
  if (err instanceof ScopeError) {
    // A scope error is always our bug, never the caller's. Log loudly, say little.
    console.error("[scope]", err.message);
    return c.json({ error: "internal", message: "Something broke on our end." }, 500);
  }
  console.error("[api]", err);
  return c.json({ error: "internal", message: "Something broke on our end." }, 500);
});

api.notFound((c) => c.json({ error: "not_found", message: "No such endpoint." }, 404));

/** Liveness. Reports which integrations are configured, never their values. */
api.get("/health", (c) => {
  const env = c.env;
  return c.json({
    ok: true,
    env: env.APP_ENV,
    // Every one of these may be false. False means the feature runs dark with
    // a friendly note — never that the app is broken.
    integrations: {
      ai: Boolean(env.ANTHROPIC_API_KEY),
      payments: Boolean(env.STRIPE_SECRET_KEY),
      email: Boolean(env.RESEND_API_KEY),
    },
  });
});

/** Who am I, and what may I do? Drives nav and permission-aware UI. */
api.get("/me", async (c) => {
  const ctx = await getContext(c.req.raw, c.env);
  if (!ctx.user) return c.json({ signedIn: false });
  return c.json({
    signedIn: true,
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.displayName },
    tenantId: ctx.tenantId,
    titles: ctx.authority.titles,
    capabilities: [...ctx.authority.anyCaps],
    clubs: [...ctx.authority.readableClubs],
  });
});

/**
 * Public join form.
 *
 * Layered defences, and spam is accepted with the same friendly answer as a
 * real submission so bots never learn which rule caught them. The club sees the
 * reason; the sender never does.
 */
api.post("/public/join/:clubSlug", async (c) => {
  const ip = clientIp(c.req.raw);
  const ipKey = await hashIp(ip, c.env.IP_HASH_SECRET ?? "dev");
  const slug = c.req.param("clubSlug");

  const limit = await checkRateLimit(c.env.KV, "joinForm", `${ipKey}:${slug}`);
  if (!limit.allowed) {
    // Same answer as success. A rate-limited bot learns nothing.
    return c.json({ ok: true, message: THANKS });
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) {
    await recordFailure(c.env.KV, "joinForm", `${ipKey}:${slug}`);
    return c.json({ ok: true, message: THANKS });
  }

  const { scoreSubmission } = await import("@domain/spam");
  const verdict = scoreSubmission({
    name: String(body.name ?? ""),
    email: String(body.email ?? ""),
    message: String(body.message ?? ""),
    honeypot: String(body.website ?? ""),
    elapsedMs: Number(body.elapsed ?? 0),
  });

  if (!verdict.valid) {
    // A real person who mistyped deserves to be told. Only genuine humans
    // reach this branch, because spam is never reported as invalid.
    return c.json({ ok: false, message: verdict.message }, 400);
  }

  const clubRow = await c.env.DB.prepare(
    `SELECT id, tenant_id FROM clubs WHERE slug = ? AND public_enabled = 1`,
  )
    .bind(slug)
    .first<{ id: string; tenant_id: string }>();

  // Even an unknown club gets the friendly answer — probing for valid slugs
  // shouldn't be possible from the response.
  if (!clubRow) return c.json({ ok: true, message: THANKS });

  await c.env.DB.prepare(
    `INSERT INTO join_submissions
       (id, tenant_id, club_id, name, email, phone, message, referred_by,
        status, spam_score, spam_reasons, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId("joinSubmission"),
      clubRow.tenant_id,
      clubRow.id,
      String(body.name ?? "").slice(0, 200),
      String(body.email ?? "").slice(0, 254),
      body.phone ? String(body.phone).slice(0, 40) : null,
      body.message ? String(body.message).slice(0, 4000) : null,
      body.referredBy ? String(body.referredBy).slice(0, 200) : null,
      verdict.isSpam ? "spam" : "new",
      verdict.score,
      verdict.reasons.join(","),
      ipKey,
      new Date().toISOString(),
    )
    .run();

  await recordFailure(c.env.KV, "joinForm", `${ipKey}:${slug}`);
  return c.json({ ok: true, message: THANKS });
});

const THANKS =
  "Thanks — someone from the club will be in touch. We're glad you're curious about us.";

// ── Operations ────────────────────────────────────────────────────────────────
//
// Running a job by hand and re-seeding the demo. Guarded by an ADMIN_TOKEN
// secret; when that secret isn't set these are reachable only from localhost,
// so a fresh checkout is fully operable while a deployed Worker without the
// secret exposes nothing.

function isLocal(req: Request): boolean {
  try {
    const h = new URL(req.url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}

function adminAllowed(c: { req: { raw: Request; header: (n: string) => string | undefined }; env: Env }): boolean {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return isLocal(c.req.raw);
  const presented = c.req.header("X-Admin-Token");
  if (!presented || presented.length !== token.length) return false;
  // Constant-time-ish: compare every character regardless of early mismatch.
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ presented.charCodeAt(i);
  return diff === 0;
}

api.post("/ops/run-job/:job", async (c) => {
  if (!adminAllowed(c)) return c.json({ error: "forbidden" }, 403);
  const { JOB_KEYS, runJob } = await import("./cron");
  const job = c.req.param("job");
  if (!(JOB_KEYS as string[]).includes(job)) {
    return c.json({ error: "unknown_job", known: JOB_KEYS }, 400);
  }
  await runJob(job as (typeof JOB_KEYS)[number], c.env);
  const row = await c.env.DB.prepare(
    `SELECT status, stats, error, duration_ms FROM job_runs WHERE job_key = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(job)
    .first<{ status: string; stats: string; error: string | null; duration_ms: number }>();
  return c.json({
    job,
    status: row?.status,
    duration_ms: row?.duration_ms,
    stats: row?.stats ? JSON.parse(row.stats) : null,
    error: row?.error ?? null,
  });
});

api.post("/ops/seed-demo", async (c) => {
  if (!adminAllowed(c)) return c.json({ error: "forbidden" }, 403);
  const { reseedDemo } = await import("@db/services/demo");
  const result = await reseedDemo(c.env, new Date().toISOString());
  return c.json({ ok: true, ...result });
});

/** Cron health, for the operations screen and for a quick look after a deploy. */
api.get("/ops/jobs", async (c) => {
  if (!adminAllowed(c)) return c.json({ error: "forbidden" }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT job_key, status, stats, error, duration_ms, created_at
       FROM job_runs ORDER BY created_at DESC LIMIT 40`,
  ).all();
  return c.json({ runs: results ?? [] });
});
