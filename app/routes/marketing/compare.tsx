import { Link } from "react-router";
import type { Route } from "./+types/compare";
import { brand } from "@content/brand";
import {
  INCUMBENTS, SIDECAR_TOOLS, PLANS, calculateSavings, formatCents,
} from "@domain/pricing";
import { marketingMeta, breadcrumbSchema, jsonLd } from "~/seo";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Sodalitas compared with ClubRunner and DACdb",
    description:
      "An honest comparison, including where ClubRunner and DACdb do more than we do, and what a club typically pays across all its tools.",
    path: "/compare",
  });
}

/**
 * A worked example, not a slider.
 *
 * A calculator invites a club to enter optimistic numbers and then believe the
 * output. A worked example with every input shown is harder to argue with and
 * easier to check against a real invoice.
 */
const EXAMPLE = calculateSavings({
  incumbentKey: "clubrunner",
  sidecarKeys: ["email", "forms", "payments"],
  planKey: "club_standard",
  period: "monthly",
});

export default function Compare() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbSchema([
              { name: "Home", path: "/" },
              { name: "Compare", path: "/compare" },
            ]),
          ),
        }}
      />

      <section className="mx-auto max-w-4xl px-6 pt-16 pb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl dark:text-ink-50">
          How we compare
        </h1>
        <p className="mt-4 text-lg text-pretty text-ink-600 dark:text-ink-300">
          ClubRunner and DACdb have served Rotary for a long time and both do things
          we don't. This page says which things, because a comparison where the other
          side never wins isn't a comparison.
        </p>
      </section>

      {/* ── Where they win ── */}
      <section className="mx-auto max-w-4xl px-6 pb-14">
        <div className="space-y-8">
          {INCUMBENTS.map((i) => (
            <div key={i.key} className="rounded-xl border border-ink-200 p-6 dark:border-ink-800">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">{i.name}</h2>
                <p className="text-sm text-ink-500">
                  typically {formatCents(i.typicalMonthlyCents)}/mo — we've seen{" "}
                  {formatCents(i.rangeMonthlyCents[0])}–{formatCents(i.rangeMonthlyCents[1])}
                </p>
              </div>
              <p className="mt-2 text-sm text-ink-500">{i.note}</p>

              <p className="mt-5 text-xs font-medium tracking-wide text-ink-500 uppercase">
                Where {i.name} is better than us
              </p>
              <ul className="mt-2 space-y-2 text-ink-700 dark:text-ink-300">
                {i.betterAt.map((line) => (
                  <li key={line} className="flex gap-2.5">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-gold-500" />
                    <span className="text-pretty">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-brand-300 bg-brand-50/50 p-6 dark:border-brand-700 dark:bg-brand-700/10">
          <h2 className="font-semibold text-ink-900 dark:text-ink-100">Where we're better</h2>
          <ul className="mt-2 space-y-2 text-ink-700 dark:text-ink-300">
            <li className="text-pretty">
              We tell you which members are drifting and why, with the evidence
              attached, every week. Neither of them does this.
            </li>
            <li className="text-pretty">
              Guest follow-up is tracked from the first visit, so a visitor who came
              once doesn't quietly become nobody's job.
            </li>
            <li className="text-pretty">
              Roles expire on the date the term ends, so the July handover doesn't
              leave last year's board holding the keys.
            </li>
            <li className="text-pretty">
              Email, forms, dues and volunteer signups are included rather than bought
              separately.
            </li>
          </ul>
        </div>
      </section>

      {/* ── The money ── */}
      <section className="border-t border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-3xl px-6 py-14">
          <h2 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
            What a club usually pays altogether
          </h2>
          <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
            Most clubs don't pay for one tool. They pay for club software, then an
            email tool, then a form builder, then something to collect dues. Here's a
            typical mid-sized club:
          </p>

          <table className="mt-7 w-full text-left text-sm">
            <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
              {EXAMPLE.breakdown.map((row) => (
                <tr key={row.label}>
                  <td className="py-2.5 text-ink-700 dark:text-ink-300">{row.label}</td>
                  <td className="py-2.5 text-right tabular-nums text-ink-900 dark:text-ink-100">
                    {formatCents(row.monthlyCents)}/mo
                  </td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2.5 text-ink-900 dark:text-ink-100">Total today</td>
                <td className="py-2.5 text-right tabular-nums text-ink-900 dark:text-ink-100">
                  {formatCents(EXAMPLE.currentMonthlyCents)}/mo
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-ink-700 dark:text-ink-300">
                  {brand.name} {PLANS.club_standard.name}
                </td>
                <td className="py-2.5 text-right tabular-nums text-ink-900 dark:text-ink-100">
                  {formatCents(EXAMPLE.ourMonthlyCents)}/mo
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-300 font-semibold dark:border-ink-700">
                <td className="pt-3 text-ink-900 dark:text-ink-100">
                  {EXAMPLE.monthlySavingCents >= 0 ? "Difference" : "Extra cost"}
                </td>
                <td className="pt-3 text-right tabular-nums text-ink-900 dark:text-ink-100">
                  {formatCents(Math.abs(EXAMPLE.monthlySavingCents))}/mo ·{" "}
                  {formatCents(Math.abs(EXAMPLE.annualSavingCents))}/yr
                </td>
              </tr>
            </tfoot>
          </table>

          {EXAMPLE.caveat && (
            <p className="mt-4 text-sm text-ink-500 italic">{EXAMPLE.caveat}</p>
          )}

          <p className="mt-6 text-sm text-ink-600 dark:text-ink-400">
            Tools a club commonly buys alongside its club software:{" "}
            {SIDECAR_TOOLS.map((t) => t.name.toLowerCase()).join(", ")}. All four are
            included in {PLANS.club_standard.name}.
          </p>

          <p className="mt-8 text-pretty text-ink-600 dark:text-ink-400">
            If your district already pays for DACdb, your club's marginal cost for it
            is nothing, and no honest comparison beats free. In that case the question
            isn't price — it's whether the retention side is worth {formatCents(PLANS.club_standard.monthlyCents)} a
            month to you.
          </p>

          <Link
            to="/pricing"
            prefetch="intent"
            className="mt-8 inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
          >
            See the plans
          </Link>
        </div>
      </section>
    </>
  );
}
