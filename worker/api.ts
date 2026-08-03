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
import { hashIp, issueToken } from "./auth/crypto";
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

// ── Payments ──────────────────────────────────────────────────────────────────
//
// Everything here is absent-safe. Without STRIPE_SECRET_KEY these endpoints
// answer honestly that online payment isn't set up, and the dues system carries
// on working exactly as it does for a club that only ever takes cheques.

/**
 * Send a treasurer to Stripe to link the club's own account.
 *
 * A GET that redirects, because it's a link in the settings page rather than a
 * form post. The `state` is a random token held in KV for ten minutes and bound
 * to the user and club that started the flow — without it, anyone could hand a
 * treasurer a crafted return URL and attach *their* Stripe account to the
 * club's payments.
 */
api.get("/stripe/connect/start", async (c) => {
  const { requireTenant } = await import("./context");
  const ctx = await requireTenant(c.req.raw, c.env);
  const clubId = c.req.query("club");
  if (!clubId) return c.json({ error: "bad_request", message: "Which club?" }, 400);
  ctx.require("payments.settings", clubId);

  const { connectConfigured, connectAuthorizeUrl } = await import("@payments/stripe");
  if (!connectConfigured(c.env)) {
    return c.json(
      {
        error: "not_configured",
        message:
          "Online payment isn't switched on for this installation. Everything else about dues works without it.",
      },
      503,
    );
  }

  const club = await ctx.db().byId<{ name: string }>("clubs", clubId, { columns: "name" });
  if (!club) return c.json({ error: "not_found" }, 404);

  const { token: state } = await issueToken();
  await c.env.KV.put(
    `stripe:oauth:${state}`,
    JSON.stringify({ userId: ctx.user.id, tenantId: ctx.tenantId, clubId }),
    { expirationTtl: 600 },
  );

  return c.redirect(
    connectAuthorizeUrl(c.env, state, { email: ctx.user.email, clubName: club.name }),
  );
});

/** Stripe sends the treasurer back here. */
api.get("/stripe/connect/return", async (c) => {
  const { tenantDb } = await import("@db/scope");
  const state = c.req.query("state");
  const code = c.req.query("code");
  const denied = c.req.query("error");

  const fail = (reason: string) =>
    c.redirect(`/app/settings?payments=${encodeURIComponent(reason)}`);

  // The treasurer pressed cancel in Stripe. Not an error worth a scary page.
  if (denied) return fail("cancelled");
  if (!state || !code) return fail("incomplete");

  const raw = await c.env.KV.get(`stripe:oauth:${state}`);
  if (!raw) return fail("expired");
  // Single-use: a state token that has been spent cannot be replayed.
  await c.env.KV.delete(`stripe:oauth:${state}`);

  const pending = JSON.parse(raw) as { userId: string; tenantId: string; clubId: string };

  // Re-check authority now, not just when the flow started. A role can change
  // in the minutes a treasurer spends filling in Stripe's forms.
  const ctx = await getContext(c.req.raw, c.env);
  if (!ctx.user || ctx.user.id !== pending.userId || ctx.tenantId !== pending.tenantId) {
    return fail("wrong_account");
  }
  if (!ctx.can("payments.settings", pending.clubId)) return fail("not_allowed");

  const { exchangeConnectCode } = await import("@payments/stripe");
  const { linkAccount } = await import("@db/services/payments");

  try {
    const accountId = await exchangeConnectCode(c.env, code);
    const result = await linkAccount(
      c.env,
      tenantDb(c.env.DB, pending.tenantId),
      pending.clubId,
      accountId,
      ctx.user.id,
      ctx.now,
    );
    return c.redirect(`/app/settings?payments=${result.chargesEnabled ? "linked" : "pending"}`);
  } catch (err) {
    console.error("[stripe] connect exchange failed", err);
    return fail("failed");
  }
});

// Refreshing and unlinking an account live in the Settings route's own action
// rather than here. They're pressed from a form on a page, and a native form
// post to a JSON endpoint leaves the treasurer staring at `{"ok":true}`.

/** Start a card payment for one dues invoice. */
api.post("/pay/invoice/:invoiceId", async (c) => {
  const { requireTenant } = await import("./context");
  const ctx = await requireTenant(c.req.raw, c.env);
  const invoiceId = c.req.param("invoiceId");

  const invoice = await ctx
    .db()
    .byId<{ club_id: string; person_id: string }>("dues_invoices", invoiceId, {
      columns: "club_id, person_id",
    });
  if (!invoice) return c.json({ error: "not_found" }, 404);

  // A member may pay their own invoice without holding a payments capability —
  // paying what you owe is not an administrative act. Anyone paying somebody
  // else's needs the capability.
  const own = await ctx
    .db()
    .first<{ id: string }>("people", {
      columns: "id",
      where: "id = ? AND user_id = ?",
      params: [invoice.person_id, ctx.user.id],
    });
  if (!own) ctx.require("payments.write", invoice.club_id);

  const body = await c.req
    .json<{ coverFee?: boolean }>()
    .catch(() => ({}) as { coverFee?: boolean });
  const club = await ctx.db().byId<{ name: string }>("clubs", invoice.club_id, { columns: "name" });

  const { checkoutInvoice, PaymentUnavailable } = await import("@db/services/payments");
  try {
    const result = await checkoutInvoice(
      c.env,
      ctx.db(),
      {
        invoiceId,
        clubId: invoice.club_id,
        clubName: club?.name ?? "the club",
        coverFee: body.coverFee === true,
        payerEmail: ctx.user.email,
      },
      ctx.now,
    );
    return c.json(result);
  } catch (err) {
    if (err instanceof PaymentUnavailable) {
      return c.json({ error: "unavailable", message: err.message }, 400);
    }
    throw err;
  }
});

/**
 * Public donation.
 *
 * Rate-limited per IP per club, because an unthrottled checkout endpoint is a
 * free card-testing service running on somebody else's Stripe account.
 */
api.post("/public/donate/:clubSlug", async (c) => {
  const { tenantDb } = await import("@db/scope");
  const { resolvePublicClubBySlug } = await import("@db/publicLookup");
  const slug = c.req.param("clubSlug");

  const ipKey = await hashIp(clientIp(c.req.raw), c.env.IP_HASH_SECRET ?? "dev");
  const limit = await checkRateLimit(c.env.KV, "donate", `${ipKey}:${slug}`);
  if (!limit.allowed) {
    return c.json(
      {
        error: "rate_limited",
        message: "That's a lot of attempts in a short time. Please try again shortly.",
      },
      429,
      { "Retry-After": String(limit.retryAfter) },
    );
  }
  // Counted whether or not it succeeds: the thing being throttled is the rate
  // of checkout creation, not a failure rate.
  await recordFailure(c.env.KV, "donate", `${ipKey}:${slug}`);

  const club = await resolvePublicClubBySlug(c.env.DB, slug);
  if (!club) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<{
    amountCents?: number;
    coverFee?: boolean;
    name?: string;
    email?: string;
  }>().catch(() => null);
  if (!body) return c.json({ error: "bad_request", message: "Nothing to process." }, 400);

  const amountCents = Math.round(Number(body.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return c.json({ error: "bad_request", message: "Please choose an amount." }, 400);
  }

  const { checkoutDonation, PaymentUnavailable } = await import("@db/services/payments");
  try {
    const result = await checkoutDonation(
      c.env,
      tenantDb(c.env.DB, club.tenant_id),
      {
        clubId: club.id,
        clubName: club.name,
        amountCents,
        coverFee: body.coverFee === true,
        donorName: body.name?.slice(0, 200) ?? null,
        donorEmail: body.email?.slice(0, 254) ?? null,
      },
      new Date().toISOString(),
    );
    return c.json({ url: result.url, chargedCents: result.chargedCents });
  } catch (err) {
    if (err instanceof PaymentUnavailable) {
      return c.json({ error: "unavailable", message: err.message }, 400);
    }
    throw err;
  }
});

/**
 * Stripe webhooks. The only thing in the product that marks money received.
 *
 * Three properties this handler must have, in order of how badly each one hurts
 * when it's missing:
 *
 *   1. Verified. An unsigned body means anyone can clear a club's arrears.
 *   2. Idempotent. Stripe retries; a club must not be credited twice.
 *   3. Fast. Stripe expects a response within seconds and retries on timeout,
 *      so the work is small and bounded and nothing here calls back out.
 *
 * A 200 with a note means "I have this and won't need it again". A 500 means
 * "please retry", and is reserved for genuine transient failure — returning it
 * for a permanent problem produces days of pointless redelivery.
 */
api.post("/stripe/webhook", async (c) => {
  const { verifyWebhook, SignatureError } = await import("@payments/stripe");
  const { tenantDb, globalDb } = await import("@db/scope");
  const {
    claimEvent,
    markEventHandled,
    applyEvent,
    tenantOf,
  } = await import("@db/services/payments");

  // The raw text, exactly as sent. Parsing and re-serialising first changes the
  // bytes and every signature check would fail.
  const payload = await c.req.text();

  let event;
  try {
    event = await verifyWebhook(payload, c.req.header("Stripe-Signature") ?? null, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof SignatureError) {
      // Deliberately terse. A rejected webhook is either misconfiguration or
      // someone probing, and neither deserves a hint about which check failed.
      console.warn("[stripe] rejected webhook:", err.message);
      return c.json({ error: "invalid_signature" }, 400);
    }
    throw err;
  }

  const now = new Date().toISOString();
  const global = globalDb(c.env.DB);

  const fresh = await claimEvent(global, event, now);
  if (!fresh) return c.json({ ok: true, note: "already seen" });

  const tenantId = tenantOf(event);
  if (!tenantId) {
    // A payment on the club's own Stripe account that we didn't create. Their
    // account, their business — acknowledge and forget.
    await markEventHandled(global, event.id, null);
    return c.json({ ok: true, note: "not ours" });
  }

  try {
    const outcome = await applyEvent(tenantDb(c.env.DB, tenantId), event, now);
    await markEventHandled(global, event.id, outcome.handled ? null : outcome.note);
    return c.json({ ok: true, note: outcome.note });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe] handler failed", event.id, event.type, message);
    // Release the claim. A 500 asks Stripe to redeliver, and a claim left in
    // place would make claimEvent reject the very retry we just asked for —
    // the payment would then be lost in the gap between the two.
    await global.run(`DELETE FROM webhook_events WHERE id = ?`, [event.id]);
    return c.json({ error: "handler_failed" }, 500);
  }
});

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
