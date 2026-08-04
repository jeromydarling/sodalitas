import { Link, data } from "react-router";
import type { Route } from "./+types/legal";
import { legalBySlug, LEGAL } from "@content/legal";
import { Icon, Eyebrow } from "~/brand";
import { marketingMeta, breadcrumbSchema, jsonLd } from "~/seo";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) {
    return marketingMeta({ title: "Legal", description: "", path: "/legal", noIndex: true });
  }
  const { doc } = loaderData;
  return marketingMeta({
    title: doc.title,
    description: doc.summary,
    path: `/legal/${doc.slug}`,
  });
}

export function loader({ params }: Route.LoaderArgs) {
  const doc = legalBySlug(params.legalSlug);
  if (!doc) throw data("No such page.", { status: 404 });
  return { doc };
}

export default function Legal({ loaderData }: Route.ComponentProps) {
  const { doc } = loaderData;

  return (
    <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbSchema([
              { name: "Sodalitas", path: "/" },
              { name: doc.title, path: `/legal/${doc.slug}` },
            ]),
          ),
        }}
      />

      <div className="grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Legal" className="lg:sticky lg:top-24 lg:self-start">
          <Eyebrow>Legal</Eyebrow>
          <ul className="mt-3 space-y-1">
            {LEGAL.map((d) => (
              <li key={d.slug}>
                <Link
                  to={`/legal/${d.slug}`}
                  prefetch="intent"
                  aria-current={d.slug === doc.slug ? "page" : undefined}
                  className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                    d.slug === doc.slug
                      ? "bg-brand-500/10 font-medium text-brand-600"
                      : "text-ink-600 hover:bg-ink-200/50 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800/50"
                  }`}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <article className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-ink-900 sm:text-4xl dark:text-ink-50">
            {doc.title}
          </h1>
          <p className="mt-4 text-lg text-pretty text-ink-600 dark:text-ink-400">{doc.summary}</p>
          <p className="mt-3 text-sm text-ink-500">
            Last updated{" "}
            <time dateTime={doc.updated}>
              {new Date(`${doc.updated}T00:00:00Z`).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </time>
          </p>

          {/* Said once, at the top, rather than discovered later. */}
          <p className="mt-8 rounded-xl border border-watch-500/30 bg-watch-500/[0.06] px-5 py-4 text-sm text-pretty text-ink-700 dark:text-ink-300">
            Written to be read rather than to be exhaustive, and not yet reviewed by a lawyer.
            If your board needs something in a particular form,{" "}
            <Link to="/contact" className="font-medium text-brand-600 hover:underline">
              ask
            </Link>{" "}
            and we'll write it.
          </p>

          <div className="mt-10 space-y-10">
            {doc.sections.map((s) => (
              <section key={s.heading}>
                <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
                  {s.heading}
                </h2>
                {s.paragraphs.map((p, i) => (
                  <p key={i} className="mt-3 text-pretty text-ink-700 dark:text-ink-300">
                    {p}
                  </p>
                ))}
                {s.list && (
                  <ul className="mt-4 space-y-2.5">
                    {s.list.map((item, i) => (
                      <li key={i} className="flex gap-3 text-pretty text-ink-700 dark:text-ink-300">
                        <Icon.Dash className="mt-1 shrink-0 text-ink-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
