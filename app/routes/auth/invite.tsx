import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/invite";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { appMeta } from "~/seo";
import { ROLES } from "@domain/roles";
import { hashToken } from "@worker/auth/crypto";
import { resolveInviteToken } from "@db/publicLookup";
import { createSession, sessionCookie, shouldUseSecureCookie } from "@worker/auth/session";
import { hashIp } from "@worker/auth/crypto";
import { clientIp } from "@worker/context";
import { Button } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Your invitation");
}

/**
 * Accept an invitation to hold an office.
 *
 * The role assignment already exists by the time this link is clicked — it was
 * written when the president filled in the form — so this page isn't granting
 * anything. It exists to sign the right person in and to prove the address
 * belongs to them, which is the same job a magic link does.
 *
 * As with unsubscribe, the loader never acts. Mail scanners fetch every link in
 * a message, and a GET that minted a session would hand a session to whatever
 * machine opened the email first.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.get(envContext);
  const invite = await resolveInviteToken(env.DB, await hashToken(params.token));
  if (!invite) return { state: "unknown" as const };

  if (invite.accepted_at) {
    return { state: "used" as const, clubName: invite.club_name, email: invite.email_norm };
  }
  if (invite.expires_at < new Date().toISOString()) {
    return { state: "expired" as const, clubName: invite.club_name, email: invite.email_norm };
  }

  return {
    state: "ready" as const,
    clubName: invite.club_name,
    email: invite.email_norm,
    roleLabel: ROLES[invite.role_key]?.label ?? invite.role_key,
    roleBlurb: ROLES[invite.role_key]?.blurb ?? "",
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const invite = await resolveInviteToken(env.DB, await hashToken(params.token));
  if (!invite || invite.accepted_at) return { failed: true as const };
  if (invite.expires_at < new Date().toISOString()) return { failed: true as const };

  const user = await env.DB.prepare(`SELECT id FROM users WHERE email_norm = ?`)
    .bind(invite.email_norm)
    .first<{ id: string }>();
  // The user row is created alongside the invite, so its absence means somebody
  // deleted the account in between. Nothing to sign in to.
  if (!user) return { failed: true as const };

  const now = new Date().toISOString();

  // Single-use, and claimed before the session is minted. A second click — or a
  // second tab — finds it already accepted and falls through to the "used"
  // branch rather than issuing a second session.
  const claimed = await env.DB.prepare(
    `UPDATE invites SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL`,
  )
    .bind(now, invite.id)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) return { failed: true as const };

  const { token } = await createSession(env, {
    userId: user.id,
    tenantId: invite.tenant_id,
    userAgent: request.headers.get("User-Agent"),
    ipHash: await hashIp(clientIp(request), env.IP_HASH_SECRET ?? "dev"),
  });

  await env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
    .bind(now, user.id)
    .run();

  return redirect("/app", {
    headers: { "Set-Cookie": sessionCookie(token, { secure: shouldUseSecureCookie(request) }) },
  });
}

export default function Invite({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  if (loaderData.state === "ready" && !actionData?.failed) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
          {loaderData.clubName
            ? `${loaderData.clubName} has asked you to serve`
            : "You've been asked to serve"}
        </h1>
        <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
          As <strong className="font-medium">{loaderData.roleLabel}</strong>.{" "}
          {loaderData.roleBlurb}
        </p>
        <p className="mt-3 text-sm text-ink-500">
          You'll be signed in as {loaderData.email}. There's no password to make up.
        </p>
        <Form method="post" className="mt-7">
          <Button type="submit" disabled={busy}>
            {busy ? "One moment…" : "Accept and sign in"}
          </Button>
        </Form>
      </Shell>
    );
  }

  // Everything else is a link that can't be used. Which kind matters: they lead
  // somewhere different, and "invalid link" for all of them earns a support
  // email every time.
  const used = loaderData.state === "used";
  const expired = loaderData.state === "expired";

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
        {used
          ? "That invitation has already been used"
          : expired
            ? "That invitation has expired"
            : "We don't recognise that link"}
      </h1>
      <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
        {used
          ? "Your account already exists — sign in and you'll find everything where it should be."
          : expired
            ? "Invitations last a week. Ask whoever invited you to send another, or just sign in — if your account was already created, it still works."
            : "It may have been from an old email, or only part of the link was copied."}
      </p>
      <Link
        to="/login"
        className="mt-7 rounded-lg bg-brand-600 px-4 py-2.5 text-center font-medium text-white hover:bg-brand-700"
      >
        Go to sign in
      </Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-16">
      <Link to="/" className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
        {brand.name}
      </Link>
      <div className="mt-8">{children}</div>
    </main>
  );
}
