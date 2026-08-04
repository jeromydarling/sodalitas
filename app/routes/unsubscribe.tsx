import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/unsubscribe";
import { envContext } from "@worker/loadContext";
import { marketingMeta } from "~/seo";
import { brand } from "@content/brand";
import { tenantDb } from "@db/scope";
import { resolveUnsubscribeToken } from "@db/publicLookup";
import { applyUnsubscribe, resubscribe, hashToken } from "@emails/unsubscribe";
import { Button } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Email preferences",
    description: "Manage what this club sends you.",
    path: "/unsubscribe",
    noIndex: true,
  });
}

/**
 * One-click unsubscribe.
 *
 * Three things this page gets right on purpose, because the alternatives are
 * all common and all bad:
 *
 *   1. **It works without a session.** Somebody who no longer wants the club's
 *      email is not going to sign in to say so.
 *   2. **It doesn't act on GET.** Mail scanners, link prefetchers and Outlook's
 *      Safe Links fetch every URL in a message; a GET that unsubscribes would
 *      silently opt people out of mail they never asked to stop. So the link
 *      shows a page with a button, and the button posts.
 *   3. **It offers the way back.** The most common reason anyone is here is a
 *      mis-click, and a person who has to email the secretary to get back on
 *      the list simply won't.
 *
 * A token is never single-use — see resolveUnsubscribeToken.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.get(envContext);
  const ref = await resolveUnsubscribeToken(env.DB, await hashToken(params.token));
  if (!ref) return { known: false as const };

  return {
    known: true as const,
    email: ref.email_norm,
    alreadyOff: ref.already,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const ref = await resolveUnsubscribeToken(env.DB, await hashToken(params.token));
  if (!ref) return { done: false as const };

  const form = await request.formData();
  const db = tenantDb(env.DB, ref.tenant_id);
  const now = new Date().toISOString();

  if (String(form.get("intent") ?? "") === "resubscribe") {
    await resubscribe(db, ref.email_norm, now);
    return { done: true as const, nowOff: false, email: ref.email_norm };
  }

  await applyUnsubscribe(db, ref.email_norm, now);
  return { done: true as const, nowOff: true, email: ref.email_norm };
}

export default function Unsubscribe({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state === "submitting";

  if (!loaderData.known) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
          We don't recognise that link
        </h1>
        <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
          It may have been from a very old email. Reply to any message from the club and
          they'll take you off the list.
        </p>
      </Shell>
    );
  }

  // After acting, the action's answer is the truth; before it, the loader's.
  const off = actionData?.done ? actionData.nowOff : loaderData.alreadyOff;
  const email = loaderData.email;

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
        {off ? "You're off the list" : "Email preferences"}
      </h1>

      {off ? (
        <>
          <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
            We won't send <strong className="font-medium">{email}</strong> any more club
            announcements or newsletters.
          </p>
          {/* Said plainly, because being unable to receive a sign-in link would
              be a genuine problem and people reasonably worry about it. */}
          <p className="mt-3 text-sm text-pretty text-ink-500">
            Things you ask for still come through — a sign-in link, a receipt, a reply to
            something you sent. Only the club's mailings stop.
          </p>
          <Form method="post" className="mt-7">
            <input type="hidden" name="intent" value="resubscribe" />
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? "One moment…" : "Actually, put me back on"}
            </Button>
          </Form>
        </>
      ) : (
        <>
          <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
            Stop sending club announcements and newsletters to{" "}
            <strong className="font-medium">{email}</strong>?
          </p>
          <Form method="post" className="mt-7">
            <Button type="submit" disabled={busy}>
              {busy ? "One moment…" : "Unsubscribe"}
            </Button>
          </Form>
          <p className="mt-4 text-sm text-ink-500">
            No hard feelings, and you can undo it on the next screen.
          </p>
        </>
      )}
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
