import { Link, data } from "react-router";
import type { Route } from "./+types/feature-detail";
import { featureBySlug, FEATURES } from "@content/features";
import { Icon, Reveal, Eyebrow } from "~/brand";
import { Media, hasMedia } from "~/media";
import { SignalsScreen, RosterScreen, MeetingScreen, DuesScreen, HealthScreen, CommitteeScreen } from "~/screens";
import { marketingMeta, breadcrumbSchema, jsonLd } from "~/seo";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) {
    return marketingMeta({ title: "Feature", description: "", path: "/features", noIndex: true });
  }
  const { feature } = loaderData;
  return marketingMeta({
    title: feature.title,
    description: feature.summary,
    path: `/features/${feature.slug}`,
    type: "article",
  });
}

export function loader({ params }: Route.LoaderArgs) {
  const feature = featureBySlug(params.featureSlug);
  if (!feature) throw data("No such feature.", { status: 404 });

  // Next and previous, so the set reads as a tour rather than eight dead ends.
  const i = FEATURES.findIndex((f) => f.slug === feature.slug);
  return {
    feature,
    prev: i > 0 ? FEATURES[i - 1]! : null,
    next: i < FEATURES.length - 1 ? FEATURES[i + 1]! : null,
  };
}

/** The miniature that belongs beside each feature, where one exists. */
const SCREENS = {
  signals: SignalsScreen,
  roster: RosterScreen,
  meeting: MeetingScreen,
  dues: DuesScreen,
  health: HealthScreen,
  committee: CommitteeScreen,
} as const;

export default function FeatureDetail({ loaderData }: Route.ComponentProps) {
  const { feature, prev, next } = loaderData;
  const Glyph = Icon[feature.icon];
  const Screen = feature.screen ? SCREENS[feature.screen] : null;
  // The screen is the better hero when there is one: it shows the actual thing
  // rather than a photograph standing in for it.
  const showMedia = !Screen && feature.media ? hasMedia(feature.media) : false;

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbSchema([
              { name: "Sodalitas", path: "/" },
              { name: "Features", path: "/features" },
              { name: feature.name, path: `/features/${feature.slug}` },
            ]),
          ),
        }}
      />

      <header className="aurora border-b border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          <Link
            to="/features"
            prefetch="intent"
            className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-brand-600"
          >
            <Icon.Arrow className="rotate-180" />
            Features
          </Link>

          {/* Two columns only when there is a picture. With no image the prose
              takes a comfortable measure instead of a half-empty grid. */}
          <div
            className={
              Screen || showMedia ? "mt-8 grid items-center gap-12 lg:grid-cols-2" : "mt-8"
            }
          >
            <div className={Screen || showMedia ? "" : "max-w-3xl"}>
              {/* Icon and label on one line. Stacked, the eyebrow's rule ran
                  into the icon tile and read as a stray mark. */}
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-500">
                  <Glyph width="1.3em" height="1.3em" />
                </span>
                <Eyebrow>{feature.name}</Eyebrow>
              </div>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl dark:text-ink-50">
                {feature.title}
              </h1>
              <p className="mt-5 text-lg text-pretty text-ink-600 dark:text-ink-400">
                {feature.summary}
              </p>
            </div>
            {Screen ? <Screen /> : showMedia && feature.media ? (
              <Media slot={feature.media} priority />
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="max-w-2xl">
            {feature.body.map((p, i) => (
              <p
                key={i}
                className="mt-5 text-lg text-pretty text-ink-700 first:mt-0 dark:text-ink-300"
              >
                {p}
              </p>
            ))}

            {/* The limit gets the same weight as the claims, not a footnote. */}
            <Reveal>
              <div className="mt-10 rounded-2xl border border-watch-500/30 bg-watch-500/[0.06] p-6">
                <h2 className="flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-100">
                  <Icon.Dash className="text-watch-500" />
                  What it doesn't do
                </h2>
                <p className="mt-2 text-pretty text-ink-700 dark:text-ink-300">{feature.limit}</p>
              </div>
            </Reveal>
          </div>

          <aside>
            <div className="sticky top-24 rounded-2xl border border-ink-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
                In practice
              </h2>
              <ul className="mt-4 space-y-3">
                {feature.does.map((d) => (
                  <li key={d} className="flex gap-3 text-sm text-ink-700 dark:text-ink-300">
                    <Icon.Check className="mt-0.5 shrink-0 text-steady-500" />
                    <span className="text-pretty">{d}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/demo"
                prefetch="intent"
                className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                See it in the demo club
                <Icon.Arrow />
              </Link>
            </div>
          </aside>
        </div>

        <div className="rule-fade mt-16" />

        <nav className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-between" aria-label="More features">
          {prev ? (
            <Link
              to={`/features/${prev.slug}`}
              prefetch="intent"
              className="group flex items-center gap-3 text-ink-600 hover:text-brand-600 dark:text-ink-400"
            >
              <Icon.Arrow className="rotate-180 transition-transform group-hover:-translate-x-0.5" />
              <span>
                <span className="block text-xs uppercase tracking-wider text-ink-400">Previous</span>
                {prev.name}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              to={`/features/${next.slug}`}
              prefetch="intent"
              className="group flex items-center gap-3 text-right text-ink-600 hover:text-brand-600 sm:ml-auto dark:text-ink-400"
            >
              <span>
                <span className="block text-xs uppercase tracking-wider text-ink-400">Next</span>
                {next.name}
              </span>
              <Icon.Arrow className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
        </nav>
      </div>
    </article>
  );
}
