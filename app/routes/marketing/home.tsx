import { Link } from "react-router";
import type { Route } from "./+types/home";
import { brand, PROMISES } from "@content/brand";
import { FEATURES } from "@content/features";
import { GUIDES } from "@content/guides";
import { PLANS } from "@domain/pricing";
import { Icon, Reveal, Eyebrow, Figure } from "~/brand";
import { RosterScreen, MeetingScreen, DuesScreen, SignalsScreen, HealthScreen } from "~/screens";
import { Media, hasMedia } from "~/media";
import {
  marketingMeta, organizationSchema, softwareSchema, faqSchema, jsonLd,
} from "~/seo";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.positioning,
    path: "/",
  });
}

const FAQS = [
  {
    q: "How is this different from ClubRunner or DACdb?",
    a: "It covers the same ground — roster, meetings, committees, dues, a public page — and adds one thing neither of them does: a weekly list of which members are drifting and what to do about it. ClubRunner still has a much more complete website builder than we do.",
  },
  {
    q: "Can we move our data across?",
    a: "Yes. Export a CSV from your current system and import it. The importer shows you exactly what it will create, update or skip before it changes anything, and you can roll a run back afterwards.",
  },
  {
    q: "Does the district have to buy it for us?",
    a: "No. A single club can subscribe on its own. If the district subscribes, every club in it is covered by that one subscription.",
  },
  {
    q: "Can the district see everything about our club?",
    a: "A district governor sees club-level health and rollups. Assistant governors read the clubs assigned to them and can leave a note or a task. Neither can run your club, and personal notes about members stay in the club that wrote them.",
  },
  {
    q: "What happens at the July handover?",
    a: "Roles have start and end dates. When a term ends the access ends with it, on the date it says, without anyone having to remember. The club's history stays put for the incoming board.",
  },
];

/** The icons standing for each promise, in the order PROMISES declares them. */
const PROMISE_ICONS = {
  retention: "Drift",
  guests: "Guest",
  handover: "Handover",
  one_place: "Plug",
  district: "District",
} as const;

/**
 * What the club runs on, said as a list of jobs rather than of modules.
 *
 * This is the section that used to be missing. Leading with retention made the
 * product read as an add-on, and a club shopping for club software concluded we
 * don't do the roster — so the first thing on the page is now the full surface.
 */
const RUNS_ON = [
  { icon: "People" as const, slug: "public-page", label: "The roster", body: "Members, classifications, history that outlives an officer." },
  { icon: "Calendar" as const, slug: "meetings", label: "Meetings", body: "Speakers, attendance and makeups, marked in one pass." },
  { icon: "Guest" as const, slug: "guests", label: "Guests", body: "Visitors tracked from the first week to induction." },
  { icon: "Committee" as const, slug: "committees", label: "Committees", body: "Rosters, chairs, and who is on nothing at all." },
  { icon: "Project" as const, slug: "committees", label: "Service projects", body: "Hours, funds raised, who actually turned up." },
  { icon: "Dues" as const, slug: "dues", label: "Dues", body: "Bill the club in one go. Cash, cheque or card." },
  { icon: "Mail" as const, slug: "public-page", label: "Club email", body: "Sent and recorded against the member it went to." },
  { icon: "Club" as const, slug: "public-page", label: "Public page", body: "Meetings, projects and a join form, kept current for you." },
  { icon: "District" as const, slug: "district", label: "Districts", body: "Rollups for a governor, without taking a club over." },
];

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(organizationSchema()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            softwareSchema({
              lowPriceCents: PLANS.club_starter.monthlyCents,
              highPriceCents: PLANS.district.monthlyCents,
            }),
          ),
        }}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema(FAQS)) }} />

      {/* ── Hero: the whole product, with the screens right there ── */}
      <section className="aurora relative overflow-hidden border-b border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-24">
          <div className="grid items-start gap-14 lg:grid-cols-[minmax(0,1fr)_26rem]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs font-medium text-ink-600 dark:border-ink-800 dark:bg-ink-900/70 dark:text-ink-400">
                <Icon.Spark className="text-gold-500" width="1em" height="1em" />
                For Rotary and Rotaract clubs and districts
              </span>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-6xl dark:text-ink-50">
                {brand.tagline}
              </h1>
              <p className="mt-6 max-w-xl text-lg text-pretty text-ink-600 sm:text-xl dark:text-ink-300">
                The roster, the meetings, the guests, the committees, the projects and the dues —
                in one place, built for the way a Rotary club actually runs its year.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  to="/features"
                  prefetch="intent"
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 font-medium text-white transition-colors hover:bg-brand-700"
                >
                  See everything it does
                  <Icon.Arrow />
                </Link>
                <form method="post" action="/demo/enter">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-lg border border-ink-300 bg-white/60 px-5 py-3 font-medium text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-900/60 dark:text-ink-200"
                  >
                    Open the demo club
                  </button>
                </form>
              </div>
              <p className="mt-6 text-sm text-ink-500">
                From {formatPlain(PLANS.club_starter.monthlyCents)} a month for a club. No sign-up
                needed to look around.
              </p>
            </div>

            {/* Real DOM, not a screenshot: selectable, theme-aware, and a
                few hundred bytes rather than a few hundred kilobytes.
                Offset rather than overlapped — the floating card used to sit on
                top of the roster's own rows and hang out of the section. */}
            {/* On a phone this used to be hidden entirely, so the visitors
                most likely to be deciding from this page alone saw none of the
                product. One screen there, both from lg up. */}
            <div className="space-y-4">
              <RosterScreen />
              <SignalsScreen className="hidden lg:block lg:ml-8" />
            </div>
          </div>

          {hasMedia("home-hero") && (
            <div className="mt-16">
              <Media slot="home-hero" priority className="shadow-sm" />
            </div>
          )}
        </div>
      </section>

      {/* ── What it runs ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <Eyebrow>The whole club</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
            Everything a club runs on, in one subscription
          </h2>
          <p className="mt-4 text-pretty text-ink-600 dark:text-ink-400">
            Most clubs pay for four or five tools that don't talk to each other. These are the
            same jobs, done once.
          </p>
        </div>

        <div className="mt-12 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {RUNS_ON.map((r, i) => {
            const Glyph = Icon[r.icon];
            return (
              <Reveal key={r.label} delay={(i % 3) as 0 | 1 | 2}>
                <Link to={`/features/${r.slug}`} prefetch="intent" className="group block">
                  <span className="flex items-center gap-2.5 font-semibold text-ink-900 group-hover:text-brand-600 dark:text-ink-100">
                    <Glyph className="text-brand-600 dark:text-brand-500" />
                    {r.label}
                  </span>
                  <p className="mt-1.5 text-sm text-pretty text-ink-600 dark:text-ink-400">
                    {r.body}
                  </p>
                </Link>
              </Reveal>
            );
          })}
        </div>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link
            to="/features"
            prefetch="intent"
            className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-4 py-2.5 font-medium text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-200"
          >
            All {FEATURES.length} features, with what each one doesn't do
            <Icon.Arrow />
          </Link>
        </div>
      </section>

      {/* ── Screens ── */}
      <section className="band border-y border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <Eyebrow>What you'll be using</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
              Dense where it needs to be, quiet everywhere else
            </h2>
            <p className="mt-4 text-pretty text-ink-600 dark:text-ink-400">
              Built for a volunteer doing club admin on a Tuesday evening, not for a
              full-time administrator. Every one of these is the real screen, with fewer rows.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Reveal delay={0}>
              <DuesScreen />
            </Reveal>
            <Reveal delay={1}>
              <HealthScreen />
            </Reveal>
            <Reveal delay={2}>
              <MeetingScreen />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Retention: now the differentiator, not the headline ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="max-w-2xl">
            <Eyebrow>And the part nobody else does</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
              It tells you who's slipping away, while there's still time
            </h2>
            <div className="mt-8 flex flex-wrap gap-10 border-y border-ink-200 py-6 dark:border-ink-800">
              <Figure value="~⅓" label="of North American Rotary membership, gone in twenty years" />
              <Figure value="7" label="names a week, at most — a list somebody acts on" />
            </div>
            <p className="mt-6 text-lg text-pretty text-ink-600 dark:text-ink-300">
              Very little of that was people leaving in a disagreement. Most of it was people
              drifting quietly out of clubs that were doing their best and had no way to notice
              in time.
            </p>
            <p className="mt-4 text-pretty text-ink-600 dark:text-ink-400">
              Every club system records attendance. This one reads it. From facts your club
              already writes down it produces a short weekly list of specific people, each with
              the evidence behind it and one thing somebody could do this week.
            </p>

            <ol className="mt-8 space-y-3">
              {[
                ["Week 1", "Misses a meeting. Work, travel, a sick parent."],
                ["Week 3", "Misses another. Nobody calls — everyone assumes somebody did."],
                ["Week 6", "Coming back now feels awkward."],
                ["July", "The club discovers it is one member shorter."],
              ].map(([when, what], i, all) => (
                <li key={when} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        i === all.length - 1 ? "bg-risk-500" : "bg-ink-300 dark:bg-ink-700"
                      }`}
                    />
                    {i < all.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-ink-200 dark:bg-ink-800" />
                    )}
                  </div>
                  <div className="pb-1">
                    <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                      {when}
                    </div>
                    <div className="text-sm text-pretty text-ink-700 dark:text-ink-300">{what}</div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/retention"
                prefetch="intent"
                className="inline-flex items-center gap-2 font-medium text-brand-600 hover:underline"
              >
                Exactly how the scoring works
                <Icon.Arrow />
              </Link>
            </div>
          </div>

          <Reveal>
            <SignalsScreen />
          </Reveal>
        </div>
      </section>

      {/* ── Promises ── */}
      <section className="border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
            Built around the year a club actually has
          </h2>
          <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {PROMISES.map((p, i) => {
              const Glyph = Icon[PROMISE_ICONS[p.key as keyof typeof PROMISE_ICONS] ?? "Check"];
              return (
                <Reveal key={p.key} delay={(i % 3) as 0 | 1 | 2}>
                  <div>
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-500">
                      <Glyph width="1.4em" height="1.4em" />
                    </span>
                    <h3 className="mt-4 text-lg font-semibold text-ink-900 dark:text-ink-100">
                      {p.title}
                    </h3>
                    <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">{p.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Guides ── */}
      <section className="border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <Eyebrow>Guides</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
                Useful whether or not you ever buy anything
              </h2>
            </div>
            <Link
              to="/guides"
              prefetch="intent"
              className="inline-flex items-center gap-2 font-medium text-brand-600 hover:underline"
            >
              All guides
              <Icon.Arrow />
            </Link>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {GUIDES.slice(0, 3).map((g, i) => (
              <Reveal key={g.slug} delay={(i % 3) as 0 | 1 | 2}>
                <Link to={`/guides/${g.slug}`} prefetch="intent" className="group block">
                  <Icon.Book className="text-ink-400" />
                  <h3 className="mt-3 font-semibold text-ink-900 group-hover:text-brand-600 dark:text-ink-100">
                    {g.title}
                  </h3>
                  <p className="mt-2 text-sm text-pretty text-ink-600 dark:text-ink-400">
                    {g.summary}
                  </p>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900 dark:text-ink-50">
            The questions clubs actually ask
          </h2>
          <dl className="mt-10 divide-y divide-ink-200 dark:divide-ink-800">
            {FAQS.map((f) => (
              <div key={f.q} className="py-5 first:pt-0">
                <dt className="font-medium text-ink-900 dark:text-ink-100">{f.q}</dt>
                <dd className="mt-2 text-pretty text-ink-600 dark:text-ink-400">{f.a}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 rounded-2xl border border-ink-200 p-8 text-center dark:border-ink-800">
            <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
              Still deciding?
            </h2>
            <p className="mx-auto mt-2 max-w-md text-pretty text-ink-600 dark:text-ink-400">
              The comparison page says where ClubRunner and DACdb each do more than we do. Read
              that one before you read anything else here.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                to="/compare"
                prefetch="intent"
                className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-4 py-2.5 font-medium text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-200"
              >
                The honest comparison
              </Link>
              <Link
                to="/contact"
                prefetch="intent"
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 font-medium text-ink-600 transition-colors hover:text-brand-600 dark:text-ink-400"
              >
                Ask a question
                <Icon.Arrow />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** Local formatter — the pricing page uses the shared one with cents handling. */
function formatPlain(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}
