import { Link } from "react-router";
import type { Route } from "./+types/guides";
import { GUIDES, readingMinutes } from "@content/guides";
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

      <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl dark:text-ink-50">
        Guides
      </h1>
      {/* The promise this section has to keep, said at the top. */}
      <p className="mt-4 text-lg text-pretty text-ink-600 dark:text-ink-400">
        Written for the people who hold an office for a year and inherit the job from someone
        who is about to stop answering their email. All of it is useful to a club that never
        buys anything from us.
      </p>

      <ul className="mt-12 space-y-10">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
              <Link to={`/guides/${g.slug}`} prefetch="intent" className="hover:text-brand-600">
                {g.title}
              </Link>
            </h2>
            <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">{g.summary}</p>
            <p className="mt-2 text-sm text-ink-500">
              {g.audience} · {readingMinutes(g)} min read
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
