import { Link, redirect } from "react-router";
import type { Route } from "./+types/demo-enter";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { appMeta } from "~/seo";
import { resolveDemoLogin } from "@db/services/demo";
import { createSession, sessionCookie, shouldUseSecureCookie } from "@worker/auth/session";
import { hashIp } from "@worker/auth/crypto";
import { clientIp, clientIp as ip } from "@worker/context";
import { checkRateLimit, recordFailure } from "@worker/auth/ratelimit";

export function meta(_: Route.MetaArgs) {
  return appMeta("Entering the demo");
}

/**
 * Sign in to the demo club.
 *
 * **POST only.** A GET that minted a session would hand one to every link
 * prefetcher, mail scanner and crawler that touched the URL, and React Router's
 * own `prefetch="intent"` would do it on hover. The button posts.
 *
 * Rate limited per IP: each entry writes a session to KV, and an unthrottled
 * session factory is a cheap way for somebody to fill it.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const ipKey = await hashIp(clientIp(request), env.IP_HASH_SECRET ?? "dev");

  const limit = await checkRateLimit(env.KV, "demoEnter", ipKey);
  if (!limit.allowed) {
    return {
      error:
        "That's a lot of demo sessions from one place in a short time. Try again in a little while.",
    };
  }
  await recordFailure(env.KV, "demoEnter", ipKey);

  const demo = await resolveDemoLogin(env.DB);
  if (!demo) {
    // The demo hasn't been seeded on this installation. Say so rather than
    // showing a broken sign-in.
    return {
      error:
        "The demo club isn't set up on this installation yet. Everything else on the site works.",
    };
  }

  const { token } = await createSession(env, {
    userId: demo.userId,
    tenantId: demo.tenantId,
    userAgent: request.headers.get("User-Agent"),
    ipHash: await hashIp(ip(request), env.IP_HASH_SECRET ?? "dev"),
  });

  return redirect("/app", {
    headers: { "Set-Cookie": sessionCookie(token, { secure: shouldUseSecureCookie(request) }) },
  });
}

/** Only reached when the action returned an error — a successful POST redirects. */
export default function DemoEnter({ actionData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-16">
      <Link to="/" className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
        {brand.name}
      </Link>
      <h1 className="mt-8 text-2xl font-semibold text-ink-900 dark:text-ink-100">
        We couldn't open the demo
      </h1>
      <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
        {actionData?.error ?? "Something went wrong on our end."}
      </p>
      <Link
        to="/demo"
        className="mt-7 rounded-lg bg-brand-600 px-4 py-2.5 text-center font-medium text-white hover:bg-brand-700"
      >
        Back
      </Link>
    </main>
  );
}
