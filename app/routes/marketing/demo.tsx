import { Form, Link } from "react-router";
import type { Route } from "./+types/demo";
import { DEMO_CLUB_NAME } from "@db/services/demo";
import { Icon, Reveal, Eyebrow } from "~/brand";
import { marketingMeta } from "~/seo";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "See a real club",
    description:
      "The Rotary Club of Lakeside is a seeded demo club with 46 members and eight months of history. Its public page is live, and signing up gives you the same thing for your own club.",
    path: "/demo",
  });
}

/**
 * The demo page.
 *
 * Two ways in, neither of which asks for an email address: the club's public
 * page, and a real signed-in session as its president. The second is the one
 * that matters — a demo behind a sign-up form is not a demo, it is a lead
 * capture with a screenshot attached.
 *
 * What makes that safe is that everything reaching outside the club refuses in
 * there. See `requireNotDemo` in worker/context.ts.
 */
const WHAT_IS_THERE = [
  ["46 members", "With attendance patterns that look like a real club's, not evenly random."],
  ["Eight months of history", "Meetings, speakers, committees, projects and dues across a Rotary year."],
  ["A signals list with people on it", "Members genuinely drifting, each with the evidence behind the score."],
  ["Guests mid-pipeline", "Visitors at different stages, some followed up and some quietly dropped."],
];

export default function Demo() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
      <header className="max-w-2xl">
        <Eyebrow>The demo club</Eyebrow>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl dark:text-ink-50">
          {DEMO_CLUB_NAME}
        </h1>
        <p className="mt-5 text-lg text-pretty text-ink-600 dark:text-ink-400">
          A seeded club that exists so there's something real to look at — and to sign in to.
          It resets every night, so nothing you do to it matters.
        </p>
      </header>

      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {WHAT_IS_THERE.map(([title, body], i) => (
          <Reveal key={title} delay={(i % 2) as 0 | 1}>
            <div className="h-full rounded-2xl border border-ink-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
              <h2 className="font-semibold text-ink-900 dark:text-ink-100">{title}</h2>
              <p className="mt-1.5 text-sm text-pretty text-ink-600 dark:text-ink-400">{body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <div className="mt-12 rounded-2xl border border-ink-200 p-8 dark:border-ink-800">
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
            Its public page is live right now
          </h2>
          <p className="mt-2 max-w-2xl text-pretty text-ink-600 dark:text-ink-400">
            This is what a visitor to your club would see: meetings, projects, officers and a
            join form, all generated from the same records the club keeps anyway. No sign-in.
          </p>
          <Link
            to="/club/lakeside"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-700"
          >
            Open the club's public page
            <Icon.Arrow />
          </Link>
        </div>
      </Reveal>

      <Reveal>
        <div className="mt-8 rounded-2xl border border-brand-300 bg-brand-500/[0.06] p-8 dark:border-brand-500/40">
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
            Or go straight inside, no sign-up
          </h2>
          <p className="mt-2 max-w-2xl text-pretty text-ink-600 dark:text-ink-400">
            Signs you in as the club president. The roster, the weekly signals with real names on
            them, attendance, committees, dues — all of it, editable. Nothing you do matters,
            because it resets every night.
          </p>
          {/* A POST, not a link: a GET here would hand a session to every link
              prefetcher and mail scanner that touched the URL. */}
          <Form method="post" action="/demo/enter" className="mt-5 flex flex-wrap gap-3">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 font-medium text-white transition-colors hover:bg-brand-700"
            >
              Open the demo club
              <Icon.Arrow />
            </button>
            <Link
              to="/signup"
              prefetch="intent"
              className="inline-flex items-center gap-2 rounded-lg px-4 py-3 font-medium text-ink-600 transition-colors hover:text-brand-600 dark:text-ink-400"
            >
              Start a real club instead
            </Link>
          </Form>
          <p className="mt-4 text-sm text-ink-500">
            Anything that would reach a real person — inviting an officer by email, taking a card
            payment, posting to Communio — is switched off in there, and says so when you try.
          </p>
        </div>
      </Reveal>
    </div>
  );
}
