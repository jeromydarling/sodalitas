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
