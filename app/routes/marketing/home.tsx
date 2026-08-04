import { Link } from "react-router";
import type { Route } from "./+types/home";
import { brand, PROMISES } from "@content/brand";
import { FEATURES } from "@content/features";
import { GUIDES } from "@content/guides";
import { PLANS } from "@domain/pricing";
import { Icon, Reveal, Eyebrow } from "~/brand";
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
    a: "Those are good at being a database and a website. Sodalitas is built around one question they don't answer: which members are drifting, and what should someone do about it this week. ClubRunner still has a much more complete website builder than we do.",
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

/** The icons that stand for each promise, in the order PROMISES declares them. */
const PROMISE_ICONS = {
  retention: "Drift",
  guests: "Guest",
  handover: "Handover",
  one_place: "Plug",
  district: "District",
} as const;

export default function Home() {
  const featured = FEATURES.slice(0, 6);

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

      {/* ── Hero ── */}
      <section className="aurora relative overflow-hidden border-b border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28 sm:pb-24">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs font-medium text-ink-600 dark:border-ink-800 dark:bg-ink-900/70 dark:text-ink-400">
              <Icon.Spark className="text-gold-500" width="1em" height="1em" />
              For Rotary and Rotaract clubs and districts
            </span>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-6xl dark:text-ink-50">
              {brand.tagline}
            </h1>
            <p className="mt-6 max-w-2xl text-lg text-pretty text-ink-600 sm:text-xl dark:text-ink-300">
              Members rarely quit a Rotary club. They miss a meeting, then a month, and somebody
              finally notices in July. Sodalitas keeps the roster and runs the meetings — and
              tells you who's slipping away while there's still time to pick up the phone.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                prefetch="intent"
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 font-medium text-white transition-colors hover:bg-brand-700"
              >
                Start with your club
                <Icon.Arrow />
              </Link>
              <Link
                to="/demo"
                prefetch="intent"
                className="inline-flex items-center gap-2 rounded-lg border border-ink-300 bg-white/60 px-5 py-3 font-medium text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-900/60 dark:text-ink-200"
              >
                See a real club
              </Link>
            </div>
            <p className="mt-6 text-sm text-ink-500">
              From {formatPlain(PLANS.club_starter.monthlyCents)} a month for a club. No setup fee
              unless you want help. Cancel whenever.
            </p>
          </div>

          {hasMedia("home-hero") && (
            <div className="mt-14">
              <Media slot="home-hero" priority className="shadow-sm" />
            </div>
          )}
        </div>
      </section>

      {/* ── The problem, with the actual number ── */}
      <section className="border-b border-ink-200 dark:border-ink-800">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_20rem] lg:py-20">
          <div className="max-w-2xl">
            <Eyebrow>The problem</Eyebrow>
            <p className="mt-4 text-xl text-pretty text-ink-800 sm:text-2xl dark:text-ink-200">
              North American Rotary membership has fallen by roughly a third in twenty years.
              Very little of that was people leaving in a disagreement.
            </p>
            <p className="mt-5 text-pretty text-ink-600 dark:text-ink-400">
              Most of it was people drifting quietly out of clubs that were doing their best and
              had no way to notice in time. Software that only records who is a member is
              software that records the decline. This one is built to interrupt it.
            </p>
            <Link
              to="/about"
              prefetch="intent"
              className="mt-6 inline-flex items-center gap-2 font-medium text-brand-600 hover:underline"
            >
              Why we built it
              <Icon.Arrow />
            </Link>
          </div>

          {/* The sequence, as the thing it is: a countdown nobody was watching. */}
          <Reveal>
            <ol className="space-y-3 rounded-2xl border border-ink-200 p-6 dark:border-ink-800">
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
          </Reveal>
        </div>
      </section>

      {/* ── The promises ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <Eyebrow>What it does</Eyebrow>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
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
      </section>

      {/* ── Features ── */}
      <section className="border-y border-ink-200 bg-white/50 dark:border-ink-800 dark:bg-ink-900/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <Eyebrow>Features</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
                Everything a club runs on
              </h2>
            </div>
            <Link
              to="/features"
              prefetch="intent"
              className="inline-flex items-center gap-2 font-medium text-brand-600 hover:underline"
            >
              All {FEATURES.length}
              <Icon.Arrow />
            </Link>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((f, i) => {
              const Glyph = Icon[f.icon];
              return (
                <Reveal key={f.slug} delay={(i % 3) as 0 | 1 | 2}>
                  <Link
                    to={`/features/${f.slug}`}
                    prefetch="intent"
                    className="group flex h-full flex-col rounded-2xl border border-ink-200 bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-brand-500/50"
                  >
                    <span className="flex items-center gap-2.5 font-medium text-ink-900 dark:text-ink-100">
                      <Glyph className="text-brand-600 dark:text-brand-500" />
                      {f.name}
                    </span>
                    <p className="mt-2 flex-1 text-sm text-pretty text-ink-600 dark:text-ink-400">
                      {f.summary}
                    </p>
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Guides ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
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
