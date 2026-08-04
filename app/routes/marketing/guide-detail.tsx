import { Link, data } from "react-router";
import type { Route } from "./+types/guide-detail";
import { guideBySlug, readingMinutes } from "@content/guides";
import { brand } from "@content/brand";
import { marketingMeta, breadcrumbSchema, jsonLd } from "~/seo";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) {
    return marketingMeta({ title: "Guide", description: "", path: "/guides", noIndex: true });
  }
  const { guide } = loaderData;
  return [
    ...marketingMeta({
      title: guide.title,
      description: guide.summary,
      path: `/guides/${guide.slug}`,
      type: "article",
    }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: guide.title,
        description: guide.summary,
        dateModified: guide.updated,
        author: { "@type": "Organization", name: brand.name },
        publisher: { "@type": "Organization", name: brand.name },
      },
    },
  ];
}

export function loader({ params }: Route.LoaderArgs) {
  const guide = guideBySlug(params.guideSlug);
  // A 404 rather than a redirect to the index: a guide that was removed should
  // stop existing, not silently become a different page, or every dead link in
  // the world quietly reports itself as working.
  if (!guide) throw data("No guide at that address.", { status: 404 });
  return { guide, minutes: readingMinutes(guide) };
}

export default function GuideDetail({ loaderData }: Route.ComponentProps) {
  const { guide, minutes } = loaderData;

  return (
    <article className="mx-auto max-w-2xl px-6 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbSchema([
              { name: "Sodalitas", path: "/" },
              { name: "Guides", path: "/guides" },
              { name: guide.title, path: `/guides/${guide.slug}` },
            ]),
          ),
        }}
      />

      <Link to="/guides" className="text-sm text-ink-500 hover:text-brand-600">
        ← Guides
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
        {guide.title}
      </h1>
      <p className="mt-4 text-lg text-pretty text-ink-600 dark:text-ink-400">{guide.summary}</p>
      <p className="mt-3 text-sm text-ink-500">
        For {guide.audience.toLowerCase()} · {minutes} min read · updated{" "}
        <time dateTime={guide.updated}>
          {new Date(`${guide.updated}T00:00:00Z`).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </time>
      </p>

      <div className="mt-12 space-y-10">
        {guide.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i} className="mt-3 text-pretty text-ink-700 dark:text-ink-300">
                {p}
              </p>
            ))}
            {s.list && (
              <ul className="mt-4 space-y-2.5">
                {s.list.map((item, i) => (
                  <li
                    key={i}
                    className="border-l-2 border-ink-200 pl-4 text-pretty text-ink-700 dark:border-ink-800 dark:text-ink-300"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {/* One quiet line at the end rather than a call to action after every
          section. A guide that sells at you paragraph by paragraph doesn't get
          finished, and doesn't get shared with the rest of the board. */}
      <footer className="mt-16 border-t border-ink-200 pt-6 dark:border-ink-800">
        <p className="text-pretty text-ink-600 dark:text-ink-400">
          {brand.name} is club software for Rotary and Rotaract built around the first of
          these problems.{" "}
          <Link to="/retention" className="text-brand-600 hover:underline">
            How the scoring works
          </Link>{" "}
          ·{" "}
          <Link to="/compare" className="text-brand-600 hover:underline">
            Compared with ClubRunner and DACdb
          </Link>
        </p>
      </footer>
    </article>
  );
}
