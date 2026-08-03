import { Link } from "react-router";
import type { Route } from "./+types/home";
import { brand, PROMISES } from "@content/brand";
import { PLANS } from "@domain/pricing";
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

      {/* ── Hero ── */}
      <section className="mx-auto max-w-4xl px-6 pt-20 pb-16 sm:pt-28">
        <h1 className="text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl dark:text-ink-50">
          {brand.tagline}
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-pretty text-ink-600 dark:text-ink-300">
          Members rarely quit a Rotary club. They miss a meeting, then a month, and
          somebody finally notices in July. Sodalitas keeps the roster and runs the
          meetings — and tells you who's slipping away while there's still time to
          pick up the phone.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link
            to="/login"
            prefetch="intent"
            className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
          >
            Try it with your club
          </Link>
          <Link
            to="/retention"
            prefetch="intent"
            className="rounded-lg border border-ink-300 px-5 py-2.5 font-medium text-ink-800 hover:border-ink-400 dark:border-ink-700 dark:text-ink-200"
          >
            How the retention part works
          </Link>
        </div>
        <p className="mt-6 text-sm text-ink-500">
          From {formatPlain(PLANS.club_starter.monthlyCents)} a month for a club.
          No setup fee unless you want help. Cancel whenever.
        </p>
      </section>

      {/* ── The problem, stated with the actual number ── */}
      <section className="border-y border-ink-200 bg-white/60 dark:border-ink-800 dark:bg-ink-900/40">
        <div className="mx-auto max-w-4xl px-6 py-14">
          <p className="text-lg text-pretty text-ink-700 dark:text-ink-200">
            North American Rotary membership has fallen by roughly a third in twenty
            years. Very little of that was people leaving in a disagreement. Most of it
            was people drifting quietly out of clubs that were doing their best and
            didn't have a way to notice in time.
          </p>
          <p className="mt-4 text-ink-600 dark:text-ink-400">
            Software that only records who is a member is software that records the
            decline. This one is built to interrupt it.
          </p>
        </div>
      </section>

      {/* ── What it does ── */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {PROMISES.map((p) => (
            <div key={p.key}>
              <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-100">{p.title}</h2>
              <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
            The questions clubs actually ask
          </h2>
          <dl className="mt-8 space-y-7">
            {FAQS.map((f) => (
              <div key={f.q}>
                <dt className="font-medium text-ink-900 dark:text-ink-100">{f.q}</dt>
                <dd className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}

/** Local formatter — the pricing page uses the shared one with cents handling. */
function formatPlain(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}
