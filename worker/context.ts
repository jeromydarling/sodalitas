/**
 * context.ts — who is asking, on behalf of which tenant, with what authority.
 *
 * Built once per request and memoised. Loaders run in parallel and each one
 * wants the current user; without memoisation a page with six loaders resolves
 * the same session six times, which on a Worker is six KV round-trips of pure
 * waste.
 */

import { tenantDb, globalDb, type TenantDb, type GlobalDb } from "@db/scope";
import {
  resolveAuthority,
  can,
  require as requireCap,
  Forbidden,
  type Authority,
  type Capability,
  type Assignment,
} from "@domain/roles";
import { readSession, sessionTokenFrom, type SessionData } from "./auth/session";
import type { SendEmailBinding } from "@emails/send";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  IMAGES?: unknown;
  AI?: unknown;
  ASSETS?: Fetcher;
  /**
   * Cloudflare Email Service. Declared in wrangler.jsonc, so it is present in
   * production and simulated by `wrangler dev` locally. Optional in the type
   * because email must keep degrading to the console if it is ever removed.
   */
  EMAIL?: SendEmailBinding;
  APP_URL: string;
  APP_ENV: string;
  MAIL_FROM: string;
  MAIL_REPLY_TO: string;
  // Secrets. Every one of these may be absent — see the degradation note in
  // each integration. Absent means "run dark", never "crash".
  ANTHROPIC_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Connect OAuth client id (ca_…). Without it, clubs can't link an account. */
  STRIPE_CONNECT_CLIENT_ID?: string;
  RESEND_API_KEY?: string;
  IP_HASH_SECRET?: string;
  /** Guards /api/ops/*. Unset means those endpoints are localhost-only. */
  ADMIN_TOKEN?: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface RequestContext {
  env: Env;
  request: Request;
  /** ISO instant, stamped once so everything in a request agrees on "now". */
  now: string;
  /** YYYY-MM-DD in UTC. Role windows and snapshots are date-based. */
  today: string;
  session: SessionData | null;
  user: CurrentUser | null;
  tenantId: string | null;
  /**
   * True when this request is inside the public demo tenant.
   *
   * Anybody on the internet can sign in there, so it gates everything that
   * reaches the outside world — see `requireNotDemo`. Read from the tenant row
   * rather than from the session, so a stale cookie can't claim otherwise.
   */
  isDemo: boolean;
  authority: Authority;
  /** Tenant-scoped data access. Throws if there is no tenant. */
  db: () => TenantDb;
  global: GlobalDb;
  can: (cap: Capability, clubId?: string | null) => boolean;
  require: (cap: Capability, clubId?: string | null) => void;
}

export class Unauthenticated extends Error {
  constructor() {
    super("Sign in to continue");
    this.name = "Unauthenticated";
  }
}

export class NoTenant extends Error {
  constructor() {
    super("This request has no club or district context");
    this.name = "NoTenant";
  }
}

const EMPTY_AUTHORITY: Authority = {
  anyCaps: new Set(),
  byScope: new Map(),
  readableClubs: new Set(),
  titles: [],
};

/** Per-request cache. Keyed by the Request object, so it cannot leak between requests. */
const cache = new WeakMap<Request, Promise<RequestContext>>();

export function getContext(request: Request, env: Env): Promise<RequestContext> {
  let ctx = cache.get(request);
  if (!ctx) {
    ctx = build(request, env);
    cache.set(request, ctx);
  }
  return ctx;
}

async function build(request: Request, env: Env): Promise<RequestContext> {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const today = now.slice(0, 10);

  const session = await readSession(env, sessionTokenFrom(request));

  let user: CurrentUser | null = null;
  let authority = EMPTY_AUTHORITY;
  const tenantId = session?.tenantId ?? null;

  let isDemo = false;

  if (session) {
    // The user row and their role assignments are independent reads.
    const [userRow, assignments, tenantRow] = await Promise.all([
      env.DB.prepare(`SELECT id, email, display_name FROM users WHERE id = ?`)
        .bind(session.userId)
        .first<{ id: string; email: string; display_name: string | null }>(),
      tenantId
        ? env.DB.prepare(
            `SELECT role_key, scope_type, scope_id, extra_caps, starts_on, ends_on
               FROM role_assignments
              WHERE tenant_id = ? AND user_id = ?`,
          )
            .bind(tenantId, session.userId)
            .all<Assignment>()
            .then((r) => r.results ?? [])
        : Promise.resolve([] as Assignment[]),
      tenantId
        ? env.DB.prepare(`SELECT is_demo FROM tenants WHERE id = ?`)
            .bind(tenantId)
            .first<{ is_demo: number }>()
        : Promise.resolve(null),
    ]);

    if (userRow) {
      user = { id: userRow.id, email: userRow.email, displayName: userRow.display_name };
      authority = resolveAuthority(assignments, today);
    }
    isDemo = tenantRow?.is_demo === 1;
    // A session whose user row is gone resolves to an anonymous context rather
    // than an error — the account was deleted while the cookie lived on.
  }

  return {
    env,
    request,
    now,
    today,
    session,
    user,
    tenantId,
    isDemo,
    authority,
    db: () => {
      if (!tenantId) throw new NoTenant();
      return tenantDb(env.DB, tenantId);
    },
    global: globalDb(env.DB),
    can: (cap, clubId) => can(authority, cap, clubId),
    /**
     * Guard a loader or action.
     *
     * Throws a 403 *Response*, not a bare Error. A thrown Error in a loader
     * surfaces as a 500 — so somebody who typed a URL for a page their office
     * doesn't include would be told the product is broken rather than that the
     * page isn't theirs. The capability travels in the body so the error page
     * can say which one, because "you can't do that" without saying what turns
     * into a support email every time.
     */
    require: (cap, clubId) => {
      try {
        requireCap(authority, cap, clubId);
      } catch (err) {
        if (err instanceof Forbidden) {
          throw new Response(err.cap, {
            status: 403,
            statusText: "Forbidden",
            headers: { "Content-Type": "text/plain" },
          });
        }
        throw err;
      }
    },
  };
}

/**
 * Refuse an action that would reach outside the demo.
 *
 * Anybody on the internet can sign in to the demo club, which makes every
 * outward-facing action a gift to whoever finds it: the officer invitation
 * would mail an arbitrary address, so would a dues payment link, and Communio
 * sharing would push text into groups that real clubs read. Unguarded, this is
 * an open spam relay attached to a real sending domain.
 *
 * So those actions refuse here rather than being trusted to a UI that hides the
 * button. The message is written to be read by a curious visitor rather than by
 * us — they did nothing wrong, and the answer is genuinely interesting.
 */
export function requireNotDemo(ctx: RequestContext, what: string): void {
  if (!ctx.isDemo) return;
  throw new Response(
    `${what} is switched off in the demo club, because anyone can sign in here and ` +
      `it would reach real people. Everything that stays inside the club works — ` +
      `add members, record a meeting, bill the dues, break whatever you like. It all ` +
      `resets overnight.`,
    { status: 403, statusText: "Not in the demo", headers: { "Content-Type": "text/plain" } },
  );
}

/** The same rule, without throwing — for hiding a control that would only fail. */
export function canLeaveDemo(ctx: RequestContext): boolean {
  return !ctx.isDemo;
}

/** Context for a signed-in user, or throw. */
export async function requireUser(request: Request, env: Env): Promise<RequestContext & { user: CurrentUser }> {
  const ctx = await getContext(request, env);
  if (!ctx.user) throw new Unauthenticated();
  return ctx as RequestContext & { user: CurrentUser };
}

/** Context for a signed-in user working in a tenant, or throw. */
export async function requireTenant(
  request: Request,
  env: Env,
): Promise<RequestContext & { user: CurrentUser; tenantId: string }> {
  const ctx = await requireUser(request, env);
  if (!ctx.tenantId) throw new NoTenant();
  return ctx as RequestContext & { user: CurrentUser; tenantId: string };
}

/** Client IP, as Cloudflare sees it. */
export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
