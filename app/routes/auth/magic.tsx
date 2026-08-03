import { Link, redirect } from "react-router";
import type { Route } from "./+types/magic";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { appMeta } from "~/seo";
import { consumeMagicLink, safeRedirect } from "@worker/auth/magic";
import { createSession, sessionCookie, shouldUseSecureCookie } from "@worker/auth/session";
import { hashIp } from "@worker/auth/crypto";
import { clientIp } from "@worker/context";

export function meta(_: Route.MetaArgs) {
  return appMeta("Signing in");
}

/**
 * Consume a sign-in link.
 *
 * A link that doesn't work is far more often innocent than hostile — it expired,
 * or a mail scanner already fetched it, or it's the second copy of a request the
 * member made twice. So the failure page explains and offers a new one rather
 * than treating the visitor as a suspect.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.get(envContext);
  const payload = await consumeMagicLink(env, params.token);
  if (!payload) return { ok: false as const };

  const user = await env.DB.prepare(`SELECT id FROM users WHERE email_norm = ?`)
    .bind(payload.emailNorm)
    .first<{ id: string }>();
  if (!user) return { ok: false as const };

  // Land in the tenant the link named, or the only one they belong to.
  let tenantId = payload.tenantId;
  if (!tenantId) {
    const membership = await env.DB.prepare(
      `SELECT tenant_id FROM tenant_users WHERE user_id = ? AND status = 'active' LIMIT 2`,
    )
      .bind(user.id)
      .all<{ tenant_id: string }>();
    const rows = membership.results ?? [];
    // Exactly one: go straight there. Several: the switcher will ask.
    tenantId = rows.length === 1 ? rows[0]!.tenant_id : null;
  }

  const { token } = await createSession(env, {
    userId: user.id,
    tenantId,
    userAgent: request.headers.get("User-Agent"),
    ipHash: await hashIp(clientIp(request), env.IP_HASH_SECRET ?? "dev"),
  });

  await env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
    .bind(new Date().toISOString(), user.id)
    .run();

  return redirect(safeRedirect(payload.redirectTo) ?? "/app", {
    headers: {
      "Set-Cookie": sessionCookie(token, { secure: shouldUseSecureCookie(request) }),
    },
  });
}

export default function Magic() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-16">
      <Link to="/" className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
        {brand.name}
      </Link>
      <h1 className="mt-8 text-2xl font-semibold text-ink-900 dark:text-ink-100">
        That link has expired
      </h1>
      <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
        Sign-in links last an hour and work once. If you clicked an older email, or
        your mail provider opened it first, that's all this is.
      </p>
      <Link
        to="/login"
        className="mt-7 rounded-lg bg-brand-600 px-4 py-2.5 text-center font-medium text-white hover:bg-brand-700"
      >
        Send me a new link
      </Link>
    </main>
  );
}
