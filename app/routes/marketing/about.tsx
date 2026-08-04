import { Link } from "react-router";
import type { Route } from "./+types/about";
import { brand } from "@content/brand";
import { Icon, Reveal, Eyebrow } from "~/brand";
import { Media, hasMedia } from "~/media";
import { marketingMeta } from "~/seo";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "Why this exists",
    description:
      "North American Rotary membership has fallen by roughly a third in two decades. Clubs don't lose people in arguments — they lose them quietly. This is software built for that specific problem.",
    path: "/about",
    type: "article",
  });
}

export default function About() {
  return (
    <article>
      <header className="aurora border-b border-ink-200 dark:border-ink-800">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <Eyebrow>Why this exists</Eyebrow>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance text-ink-900 sm:text-5xl dark:text-ink-50">
            Clubs don't lose members in arguments. They lose them quietly.
          </h1>
          <p className="mt-6 text-lg text-pretty text-ink-600 dark:text-ink-400">
            {brand.name} is {brand.meaning} It is built for one problem, and it is worth being
            plain about which one.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-16">
        {hasMedia("about-hero") && (
          <Media slot="about-hero" className="mb-12" priority />
        )}

        <div className="space-y-5 text-lg text-pretty text-ink-700 dark:text-ink-300">
          <p>
            North American Rotary membership has fallen by roughly a third in two decades. That
            number gets quoted at district conferences, usually followed by a recruitment
            initiative. Recruitment is not the problem. Clubs bring in new members most years.
            They just lose slightly more than they bring in, and the losses are invisible until
            the annual count.
          </p>
          <p>
            A member misses a meeting for an ordinary reason. They miss the next one because the
            first made it easier. Nobody calls, because everybody assumes somebody else did. Six
            weeks later coming back feels awkward, and awkwardness is a more powerful force than
            any of us like to admit. The resignation email, when it eventually arrives, is a
            formality — the membership ended months earlier.
          </p>
          <p>
            Meanwhile the club's software recorded all of it faithfully and told nobody. It knew
            the attendance. It knew they were on no committee. It knew nobody had spoken to them
            since March. It had every fact required to say <em>call Margaret this week</em>, and
            it was never asked, because association software is built to record a club rather
            than to notice one.
          </p>
        </div>

        <Reveal>
          <blockquote className="my-12 border-l-2 border-brand-500 pl-6">
            <p className="text-xl text-pretty text-ink-800 dark:text-ink-200">
              Software that only records who is a member is software that records the decline.
            </p>
          </blockquote>
        </Reveal>

        <div className="space-y-5 text-lg text-pretty text-ink-700 dark:text-ink-300">
          <p>
            So this product has one job it will not compromise on: watch what the club already
            writes down, and every week say something specific and actionable about a named
            person, with the evidence attached. Everything else here — the roster, the meetings,
            the dues, the public page — exists partly for its own sake and partly because it
            produces the facts that job runs on.
          </p>
          <p>
            The scoring is deliberately not AI. It is a fixed set of rules over facts your club
            recorded, published in full, producing the same score from the same inputs every
            time. You can read exactly why somebody was flagged, and disagree, and the
            disagreement is kept. A model that produced a number nobody could interrogate would
            be easier to build and worth much less — a club that can't argue with its software
            stops trusting it, and then stops entering data, and then the whole thing is a
            more expensive spreadsheet.
          </p>
        </div>

        <Reveal>
          <h2 className="mt-14 text-2xl font-semibold text-ink-900 dark:text-ink-100">
            Some things we've decided
          </h2>
          <ul className="mt-6 space-y-5">
            {[
              [
                "Never tell a club it is failing.",
                "Volunteers run these clubs in the evenings after their actual jobs. A dashboard that scolds them is one they stop opening, and it will have been technically correct the whole time.",
              ],
              [
                "A club's roster belongs to that club.",
                "Districts see rollups. Assistant governors see the clubs they're assigned to. Cross-club sharing strips identifying detail before it leaves, and refuses entirely in groups too small to anonymise.",
              ],
              [
                "Say what we don't do.",
                "Every feature page names its limits in the same size type as its claims, and the comparison page says where ClubRunner and DACdb each do more than we do.",
              ],
              [
                "We never hold your money.",
                "Clubs connect their own Stripe account, and every payment lands in the club's bank. We take no percentage of dues or donations. Paid event tickets carry 1%, capped at $1.50 an order — named here rather than left for you to find.",
              ],
              [
                "Access expires on its own.",
                "Rotary offices turn over every July. Roles carry end dates, so last year's treasurer stops having the keys without anybody having to remember.",
              ],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-4">
                <Icon.Check className="mt-1 shrink-0 text-steady-500" />
                <p className="text-pretty text-ink-700 dark:text-ink-300">
                  <strong className="font-semibold text-ink-900 dark:text-ink-100">{title}</strong>{" "}
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal>
          <div className="mt-14 rounded-2xl border border-ink-200 p-8 dark:border-ink-800">
            <h2 className="font-semibold text-ink-900 dark:text-ink-100">
              This is new, and that's a real cost
            </h2>
            <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">
              ClubRunner and DACdb have been serving Rotary for decades and have earned the trust
              that comes with it. We haven't. If your club needs a deep website builder or direct
              Rotary International synchronisation, they are the better answer today and we say
              so on the comparison page. What we do better is the one thing this was built for.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/compare"
                prefetch="intent"
                className="inline-flex items-center gap-2 rounded-lg border border-ink-300 px-4 py-2.5 font-medium text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-200"
              >
                The honest comparison
                <Icon.Arrow />
              </Link>
              <Link
                to="/demo"
                prefetch="intent"
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-brand-700"
              >
                See the demo club
                <Icon.Arrow />
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </article>
  );
}
