import { Link } from "react-router";
import type { Route } from "./+types/guides";
import { GUIDES, readingMinutes } from "@content/guides";
import { Icon, Reveal, Eyebrow } from "~/brand";
import { marketingMeta, breadcrumbSchema, jsonLd } from "~/seo";

export function meta(_: Route.MetaArgs) {
  return [
    ...marketingMeta({
      title: "Guides for club officers",
      description:
        "Practical guides on keeping members, onboarding new ones, surviving the July handover, and what club software actually costs. Written for club officers, useful whether or not you ever buy anything.",
      path: "/guides",
    }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Guides for club officers",
        hasPart: GUIDES.map((g) => ({
          "@type": "Article",
          headline: g.title,
          description: g.summary,
          url: `/guides/${g.slug}`,
          dateModified: g.updated,
        })),
      },
    },
  ];
}

export default function GuidesIndex() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbSchema([
              { name: "Sodalitas", path: "/" },
              { name: "Guides", path: "/guides" },
            ]),
          ),
        }}
      />

      <Eyebrow>Guides</Eyebrow>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl dark:text-ink-50">
        Written for whoever got handed the job
      </h1>
      {/* The promise this section has to keep, said at the top. */}
      <p className="mt-5 max-w-2xl text-lg text-pretty text-ink-600 dark:text-ink-400">
        For the people who hold an office for a year and inherit it from someone about to stop
        answering their email. All of it is useful to a club that never buys anything from us.
      </p>

      <ul className="mt-14 space-y-4">
        {GUIDES.map((g, i) => (
          <Reveal key={g.slug} delay={(i % 3) as 0 | 1 | 2}>
            <li>
              <Link
                to={`/guides/${g.slug}`}
                prefetch="intent"
                className="group flex gap-5 rounded-2xl border border-ink-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-brand-300 dark:border-ink-800 dark:bg-ink-900 dark:hover:border-brand-500/50"
              >
                <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 sm:flex dark:text-brand-500">
                  <Icon.Book />
                </span>
                <span className="min-w-0">
                  <h2 className="font-semibold text-ink-900 group-hover:text-brand-600 dark:text-ink-100">
                    {g.title}
                  </h2>
                  <p className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">{g.summary}</p>
                  <p className="mt-2.5 text-sm text-ink-500">
                    {g.audience} · {readingMinutes(g)} min read
                  </p>
                </span>
              </Link>
            </li>
          </Reveal>
        ))}
      </ul>
    </div>
  );
}
