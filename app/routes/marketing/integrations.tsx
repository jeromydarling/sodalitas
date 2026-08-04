import { Link } from "react-router";
import type { Route } from "./+types/integrations";
import { Icon, Reveal, Eyebrow } from "~/brand";
import { marketingMeta } from "~/seo";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Integrations",
    description:
      "What Sodalitas connects to today, what it deliberately replaces, and what it doesn't connect to yet — including Rotary International.",
    path: "/integrations",
  });
}

/**
 * Integrations, told in three groups.
 *
 * Most integration pages are a wall of logos implying partnerships that are
 * really just "we can read a CSV". These are grouped by what they actually mean
 * for a club: things that work now, things you stop paying for, and things
 * people ask about that don't exist. The third group is the one that saves
 * somebody a sales call.
 */
const WORKING = [
  {
    icon: "Dues" as const,
    name: "Stripe",
    body:
      "Dues, donations and event tickets by card. Your club connects its own Stripe account, so the money lands in the club's bank under the club's own tax identity. We take no cut of dues or donations. Paid event tickets carry a small platform fee — 1%, capped at $1.50 an order, nothing on free events — and it's the only money of yours we take.",
  },
  {
    icon: "Mail" as const,
    name: "Email",
    body:
      "Sending is built in and needs no account of yours. Every message is recorded against the member it went to, and every bulk message carries a working unsubscribe.",
  },
  {
    icon: "Import" as const,
    name: "CSV, from anywhere",
    body:
      "ClubRunner, DACdb, or the spreadsheet somebody has kept since 2009. Columns are matched for you, every run is a dry run first, and it stays reversible until you commit.",
  },
  {
    icon: "Spark" as const,
    name: "Claude",
    body:
      "Optional. Drafts a follow-up note or a meeting recap for a person to edit and send. It never produces a score and never decides anything — the retention model is rules, not a model.",
  },
];

const REPLACED = [
  ["Mailchimp or Constant Contact", "Club email, lists and unsubscribes are included."],
  ["SignUpGenius", "Volunteer signups for projects and meetings."],
  ["Eventbrite", "Meeting and event RSVPs, without per-ticket fees."],
  ["Google Forms", "The join form, feeding your membership pipeline directly."],
  ["A separate invoicing tool", "Dues billing, payments, waivers and receipts."],
  ["The club's shared spreadsheet", "The roster, with history that survives July."],
];

const NOT_YET = [
  {
    name: "Rotary International",
    body:
      "No direct membership synchronisation. This is the honest gap against both ClubRunner and DACdb, and the one most likely to matter to your district. Membership numbers here are what your clubs record, not what RI holds.",
  },
  {
    name: "QuickBooks or Xero",
    body:
      "No accounting integration. Dues and payments export as CSV, and a treasurer reconciles by hand.",
  },
  {
    name: "Google Calendar and Outlook",
    body:
      "No two-way calendar sync yet. Meetings live here and are published on your club page.",
  },
  {
    name: "Zapier and webhooks",
    body: "No public API or webhooks yet. Worth asking about if it's the thing standing in your way.",
  },
];

export default function Integrations() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <header className="max-w-2xl">
        <Eyebrow>Integrations</Eyebrow>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl dark:text-ink-50">
          What it connects to, and what it replaces
        </h1>
        <p className="mt-5 text-lg text-pretty text-ink-600 dark:text-ink-400">
          Most of the value here isn't a connection — it's the four subscriptions a club stops
          paying for. The third section is the one worth reading before you decide anything.
        </p>
      </header>

      <section className="mt-16">
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Works today</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {WORKING.map((w, i) => {
            const Glyph = Icon[w.icon];
            return (
              <Reveal key={w.name} delay={(i % 2) as 0 | 1}>
                <div className="h-full rounded-2xl border border-ink-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-500">
                    <Glyph />
                  </span>
                  <h3 className="mt-4 font-semibold text-ink-900 dark:text-ink-100">{w.name}</h3>
                  <p className="mt-2 text-sm text-pretty text-ink-600 dark:text-ink-400">{w.body}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
          Things you can stop paying for
        </h2>
        <p className="mt-2 max-w-2xl text-pretty text-ink-600 dark:text-ink-400">
          Worth doing this arithmetic properly. Most clubs are surprised by the total, and for
          some of them it still won't be worth moving — which is a real answer.
        </p>
        <ul className="mt-6 divide-y divide-ink-200 rounded-2xl border border-ink-200 dark:divide-ink-800 dark:border-ink-800">
          {REPLACED.map(([name, body]) => (
            <li key={name} className="flex flex-col gap-1 p-5 sm:flex-row sm:items-baseline sm:gap-6">
              <span className="flex items-center gap-2.5 font-medium text-ink-900 sm:w-72 sm:shrink-0 dark:text-ink-100">
                <Icon.Check className="shrink-0 text-steady-500" />
                {name}
              </span>
              <span className="text-pretty text-ink-600 dark:text-ink-400">{body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16">
        <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Doesn't exist yet</h2>
        <p className="mt-2 max-w-2xl text-pretty text-ink-600 dark:text-ink-400">
          Listed as plainly as the rest. Finding this out after moving your club is the sort of
          thing a district hears about for years.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {NOT_YET.map((n) => (
            <div
              key={n.name}
              className="rounded-2xl border border-ink-200 p-6 dark:border-ink-800"
            >
              <h3 className="flex items-center gap-2.5 font-medium text-ink-900 dark:text-ink-100">
                <Icon.Cross className="shrink-0 text-ink-400" />
                {n.name}
              </h3>
              <p className="mt-2 text-sm text-pretty text-ink-600 dark:text-ink-400">{n.body}</p>
            </div>
          ))}
        </div>
      </section>

      <Reveal>
        <div className="mt-16 rounded-2xl border border-ink-200 p-8 dark:border-ink-800">
          <h2 className="font-semibold text-ink-900 dark:text-ink-100">
            Is one of those gaps the thing stopping you?
          </h2>
          <p className="mt-2 max-w-2xl text-pretty text-ink-600 dark:text-ink-400">
            Say so. It's genuinely useful to know which absence is load-bearing for real clubs,
            and we'd rather hear it than guess.
          </p>
          <Link
            to="/contact"
            prefetch="intent"
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-ink-300 px-4 py-2.5 font-medium text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-200"
          >
            Tell us
            <Icon.Arrow />
          </Link>
        </div>
      </Reveal>
    </div>
  );
}
