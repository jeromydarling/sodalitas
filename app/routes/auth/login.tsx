import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/login";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { marketingMeta } from "~/seo";
import { looksLikeEmail, normalizeEmail, hashIp } from "@worker/auth/crypto";
import { checkAll, recordFailure } from "@worker/auth/ratelimit";
import { issueMagicLink, magicLinkUrl, safeRedirect, NEUTRAL_SIGNIN_MESSAGE } from "@worker/auth/magic";
import { clientIp } from "@worker/context";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Sign in",
    description: `Sign in to ${brand.name}.`,
    path: "/login",
    noIndex: true,
  });
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const form = await request.formData();
  const rawEmail = String(form.get("email") ?? "");
  const redirectTo = safeRedirect(String(form.get("redirectTo") ?? "")) ?? "/app";

  if (!looksLikeEmail(rawEmail)) {
    return {
      error: "That email address doesn't look quite right. Mind checking it?",
      sent: false,
    };
  }

  const email = normalizeEmail(rawEmail);
  const ipKey = await hashIp(clientIp(request), env.IP_HASH_SECRET ?? "dev");

  const limit = await checkAll(env.KV, [
    { rule: "magicLink", subject: email },
    { rule: "magicLinkIp", subject: ipKey },
  ]);
  if (!limit.allowed) {
    // Deliberately the same message as success. Rate limiting must not become
    // a way to learn which addresses exist.
    return { error: null, sent: true, message: NEUTRAL_SIGNIN_MESSAGE };
  }

  const user = await env.DB.prepare(`SELECT id FROM users WHERE email_norm = ?`)
    .bind(email)
    .first<{ id: string }>();

  // Only mint and mail a link when there's somewhere to send it — but the
  // response below is identical either way. This is the whole point: a login
  // form that says "no account with that email" is a membership-list oracle.
  if (user) {
    const { token } = await issueMagicLink(env, { email, redirectTo });
    const url = magicLinkUrl(env.APP_URL, token);

    if (env.RESEND_API_KEY) {
      // Mail adapter lands with the email suite; until then the link is logged
      // so the flow is fully usable in development without any provider key.
      console.log(`[auth] would email sign-in link to ${email}`);
    } else {
      console.log(`[auth] no mail provider configured. Sign-in link for ${email}: ${url}`);
    }
  }

  await recordFailure(env.KV, "magicLink", email);
  return { error: null, sent: true, message: NEUTRAL_SIGNIN_MESSAGE };
}

export default function Login({ actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-16">
      <Link to="/" className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
        {brand.name}
      </Link>

      {actionData?.sent ? (
        <>
          <h1 className="mt-8 text-2xl font-semibold text-ink-900 dark:text-ink-100">
            Check your inbox
          </h1>
          <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">{actionData.message}</p>
          <p className="mt-6 text-sm text-ink-500">
            Nothing arrived? Give it a minute, then check spam.{" "}
            <Link to="/login" className="text-brand-600 hover:underline">
              Try again
            </Link>
            .
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-8 text-2xl font-semibold text-ink-900 dark:text-ink-100">Sign in</h1>
          <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">
            We'll email you a link. No password to remember, and nothing to reset next
            July when someone else takes over.
          </p>

          <Form method="post" className="mt-8">
            <label htmlFor="email" className="block text-sm font-medium text-ink-800 dark:text-ink-200">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              className="mt-1.5 w-full rounded-lg border border-ink-300 bg-white px-3.5 py-2.5 text-ink-900 placeholder:text-ink-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
              placeholder="you@example.com"
              aria-describedby={actionData?.error ? "email-error" : undefined}
            />
            {actionData?.error && (
              <p id="email-error" className="mt-2 text-sm text-risk-500">
                {actionData.error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Email me a link"}
            </button>
          </Form>
        </>
      )}
    </main>
  );
}
