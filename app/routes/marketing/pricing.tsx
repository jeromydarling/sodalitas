import { Link } from "react-router";
import type { Route } from "./+types/pricing";
import { brand } from "@content/brand";
import {
  PLANS, PLAN_ORDER, SETUP_OPTIONS, ANNUAL_MONTHS_CHARGED,
  annualCents, annualSavingCents, formatCents,
} from "@domain/pricing";
import { marketingMeta, faqSchema, jsonLd } from "~/seo";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Pricing",
    description:
      "Club plans from $39 a month, districts at $199 covering every club. Every limit stated up front, no setup fee unless you want help.",
    path: "/pricing",
  });
}

const FAQS = [
  {
    q: "Is there a setup fee?",
    a: "Only if you want help. Importing a CSV yourself is free and is the right choice for most clubs.",
  },
  {
    q: "What happens if we go over 50 members on Club Starter?",
    a: "We'll tell you and you can move up to Club Standard. Nothing stops working and nobody gets locked out mid-year.",
  },
  {
    q: "Does the district plan really cover every club?",
    a: "Yes. One subscription, no per-club charge and no member limit. A district with 60 clubs pays the same as a district with 12.",
  },
  {
    q: "Can we cancel?",
    a: "Any time, and you can export everything first. Your data leaves with you.",
  },
];

export default function Pricing() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema(FAQS)) }} />

      <section className="mx-auto max-w-6xl px-6 pt-16 pb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl dark:text-ink-50">
          Pricing
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-pretty text-ink-600 dark:text-ink-300">
          Every limit is on this page. Nothing is discovered at renewal, and there is
          no per-member charge that quietly grows as your club does.
        </p>
        <p className="mt-3 text-sm text-ink-500">
          Pay annually and you're charged for {ANNUAL_MONTHS_CHARGED} months instead of 12.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="grid gap-6 lg:grid-cols-3">
          {PLAN_ORDER.map((key) => {
            const plan = PLANS[key];
            const featured = key === "club_standard";
            return (
              <div
                key={key}
                className={[
                  "flex flex-col rounded-2xl border p-6",
                  featured
                    ? "border-brand-500 bg-white shadow-sm dark:bg-ink-900"
                    : "border-ink-200 bg-white/60 dark:border-ink-800 dark:bg-ink-900/40",
                ].join(" ")}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-100">{plan.name}</h2>
                  {featured && (
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                      Most clubs
                    </span>
                  )}
                </div>
                <p className="mt-2 min-h-12 text-sm text-pretty text-ink-600 dark:text-ink-400">
                  {plan.audience}
                </p>

                <p className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-3xl font-semibold text-ink-900 dark:text-ink-50">
                    {formatCents(plan.monthlyCents)}
                  </span>
                  <span className="text-ink-500">/month</span>
                </p>
                <p className="mt-1 text-sm text-ink-500">
                  or {formatCents(annualCents(plan))}/year — saves{" "}
                  {formatCents(annualSavingCents(plan))}
                </p>

                <ul className="mt-6 flex-1 space-y-2 text-sm text-ink-700 dark:text-ink-300">
                  {plan.includes.map((line) => (
                    <li key={line} className="flex gap-2.5">
                      <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-brand-500" />
                      <span className="text-pretty">{line}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 border-t border-ink-200 pt-4 dark:border-ink-800">
                  <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">Limits</p>
                  <ul className="mt-1.5 space-y-1 text-sm text-ink-600 dark:text-ink-400">
                    {plan.limits.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </div>

                <Link
                  to="/login"
                  prefetch="intent"
                  className={[
                    "mt-6 rounded-lg px-4 py-2.5 text-center font-medium",
                    featured
                      ? "bg-brand-600 text-white hover:bg-brand-700"
                      : "border border-ink-300 text-ink-800 hover:border-ink-400 dark:border-ink-700 dark:text-ink-200",
                  ].join(" ")}
                >
                  Start with {plan.name}
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Setup ── */}
      <section className="border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-4xl px-6 py-14">
          <h2 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
            Getting your data across
          </h2>
          <div className="mt-8 space-y-6">
            {SETUP_OPTIONS.map((o) => (
              <div
                key={o.key}
                className="rounded-xl border border-ink-200 p-5 dark:border-ink-800"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-medium text-ink-900 dark:text-ink-100">{o.name}</h3>
                  <span className="shrink-0 font-medium text-ink-900 dark:text-ink-100">
                    {o.priceCents === 0 ? "Free" : formatCents(o.priceCents)}
                  </span>
                </div>
                <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">{o.description}</p>
                {/* Saying when not to buy something is the whole reason anyone
                    believes the rest of the page. */}
                <p className="mt-2 text-sm text-ink-500 italic">{o.skipIf}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-3xl px-6 py-14">
          <h2 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">Questions</h2>
          <dl className="mt-8 space-y-7">
            {FAQS.map((f) => (
              <div key={f.q}>
                <dt className="font-medium text-ink-900 dark:text-ink-100">{f.q}</dt>
                <dd className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">{f.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 text-sm text-ink-500">
            {brand.name} isn't affiliated with Rotary International. Comparisons on the{" "}
            <Link to="/compare" className="text-brand-600 hover:underline">
              compare page
            </Link>{" "}
            use published and widely-reported figures, and say where other tools do more
            than we do.
          </p>
        </div>
      </section>
    </>
  );
}
