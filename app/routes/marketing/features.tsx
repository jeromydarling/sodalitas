import { Link } from "react-router";
import type { Route } from "./+types/features";
import { FEATURES } from "@content/features";
import { Icon, Reveal, Eyebrow } from "~/brand";
import { marketingMeta, breadcrumbSchema, jsonLd } from "~/seo";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Everything Sodalitas does",
    description:
      "Retention scoring, guests and prospects, meetings and attendance, committees, projects, dues, districts, migration and a public club page — with what each one doesn't do stated alongside.",
    path: "/features",
  });
}

export default function Features() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbSchema([
              { name: "Sodalitas", path: "/" },
              { name: "Features", path: "/features" },
            ]),
          ),
        }}
      />

      <header className="max-w-2xl">
        <Eyebrow>Features</Eyebrow>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl dark:text-ink-50">
          Everything a club actually does, in one place
        </h1>
        <p className="mt-5 text-lg text-pretty text-ink-600 dark:text-ink-400">
          Each of these has a page saying what it does and — in the same size type — what it
          doesn't. A club that finds a limit after paying tells the other clubs in its district,
          and Rotary districts are small worlds.
        </p>
      </header>

      <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => {
          const Glyph = Icon[f.icon];
          return (
            <Reveal key={f.slug} delay={(i % 3) as 0 | 1 | 2}>
              <Link
                to={`/features/${f.slug}`}
                prefetch="intent"
                className="group flex h-full flex-col rounded-2xl border border-ink-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-brand-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-brand-500/50"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-500">
                  <Glyph />
                </span>
                <h2 className="mt-4 font-semibold text-ink-900 dark:text-ink-100">{f.title}</h2>
                <p className="mt-2 flex-1 text-sm text-pretty text-ink-600 dark:text-ink-400">
                  {f.summary}
                </p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600">
                  {f.name}
                  <Icon.Arrow className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          );
        })}
      </div>

      <Reveal>
        <div className="mt-20 rounded-2xl border border-ink-200 p-8 text-center dark:border-ink-800">
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
            The demo club has all of it, with eight months of history
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-pretty text-ink-600 dark:text-ink-400">
            Forty-six members, real attendance patterns, and a signals list with people on it.
            No sign-up, and you can break anything you like — it resets every Sunday.
          </p>
          <Link
            to="/demo"
            prefetch="intent"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-700"
          >
            Open the demo club
            <Icon.Arrow />
          </Link>
        </div>
      </Reveal>
    </div>
  );
}
