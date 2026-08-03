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
  type Authority,
  type Capability,
  type Assignment,
} from "@domain/roles";
import { readSession, sessionTokenFrom, type SessionData } from "./auth/session";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  IMAGES?: unknown;
  AI?: unknown;
  ASSETS?: Fetcher;
  APP_URL: string;
  APP_ENV: string;
  MAIL_FROM: string;
  MAIL_REPLY_TO: string;
  // Secrets. Every one of these may be absent — see the degradation note in
  // each integration. Absent means "run dark", never "crash".
  ANTHROPIC_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
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

  if (session) {
    // The user row and their role assignments are independent reads.
    const [userRow, assignments] = await Promise.all([
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
    ]);

    if (userRow) {
      user = { id: userRow.id, email: userRow.email, displayName: userRow.display_name };
      authority = resolveAuthority(assignments, today);
    }
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
    authority,
    db: () => {
      if (!tenantId) throw new NoTenant();
      return tenantDb(env.DB, tenantId);
    },
    global: globalDb(env.DB),
    can: (cap, clubId) => can(authority, cap, clubId),
    require: (cap, clubId) => requireCap(authority, cap, clubId),
  };
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
