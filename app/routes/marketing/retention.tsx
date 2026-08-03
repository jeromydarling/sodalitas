import { Link } from "react-router";
import type { Route } from "./+types/retention";
import { CLUB_WEIGHTS, MEMBER_WEIGHTS, NEW_MEMBER_GRACE_DAYS } from "@domain/scoring";
import { WEEKLY_SIGNAL_CAP } from "@domain/signals";
import { marketingMeta, faqSchema, breadcrumbSchema, jsonLd } from "~/seo";

export function meta(_: Route.MetaArgs) {
  return marketingMeta({
    title: "How Sodalitas helps clubs keep members",
    description:
      "A plain explanation of how member engagement and club health are scored — what goes in, how it's weighted, and why no AI produces the number.",
    path: "/retention",
    type: "article",
  });
}

const FAQS = [
  {
    q: "Does AI decide who is at risk?",
    a: "No. The score is a fixed set of rules over facts your club already records — attendance, involvement, when someone was last spoken to, whether dues are current. The same facts always produce the same score. AI can help draft a note afterwards, but a person sends it.",
  },
  {
    q: "Will it flag our honorary members?",
    a: "No. Honorary and corporate members aren't held to weekly attendance, because nobody expects them to attend weekly. Judging them by that standard would fill the list with people who are exactly where everyone agreed they'd be.",
  },
  {
    q: "What about someone on a leave of absence?",
    a: "Never flagged. They told you they'd be away. Treating that as drifting would generate exactly the outreach they asked you not to send.",
  },
  {
    q: "We just joined and everything looks bad. Is our club failing?",
    a: `No — we just don't know yet. A club with nothing recorded shows as "not enough information", not "at risk". New members get ${NEW_MEMBER_GRACE_DAYS} days to settle before anyone is flagged.`,
  },
  {
    q: "Can I see why someone was flagged?",
    a: "Always. Every score shows its drivers — what was measured, what it scored, and what was available. If you disagree, you dismiss it and say why, and that's recorded too.",
  },
];

const CLUB_INPUTS = [
  { label: "Attendance, and whether it's rising or falling", weight: CLUB_WEIGHTS.attendance },
  { label: "Members gained and lost, relative to club size", weight: CLUB_WEIGHTS.growth },
  { label: "Prospective members currently in conversation", weight: CLUB_WEIGHTS.pipeline },
  { label: "How many members are on a committee or a project", weight: CLUB_WEIGHTS.participation },
  { label: "Dues that are current", weight: CLUB_WEIGHTS.dues },
  { label: "Whether at-risk members have actually been contacted", weight: CLUB_WEIGHTS.followThrough },
];

const MEMBER_INPUTS = [
  { label: "When they last attended, and how often", weight: MEMBER_WEIGHTS.attendance },
  { label: "Committees and projects they're part of", weight: MEMBER_WEIGHTS.participation },
  { label: "When someone last had a conversation with them", weight: MEMBER_WEIGHTS.connection },
  { label: "Whether their dues are current", weight: MEMBER_WEIGHTS.dues },
  { label: "How long they've been in the club", weight: MEMBER_WEIGHTS.tenure },
];

export default function Retention() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqSchema(FAQS)) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbSchema([
              { name: "Home", path: "/" },
              { name: "Keeping members", path: "/retention" },
            ]),
          ),
        }}
      />

      <article className="mx-auto max-w-3xl px-6 pt-16 pb-16">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl dark:text-ink-50">
          How the retention part works
        </h1>
        <p className="mt-4 text-lg text-pretty text-ink-600 dark:text-ink-300">
          No black box. Here is exactly what goes into the numbers, what they weigh,
          and what the club is asked to do about them.
        </p>

        <h2 className="mt-12 text-xl font-semibold text-ink-900 dark:text-ink-100">
          What we measure about a member
        </h2>
        <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">
          Out of 100. Attendance carries the most weight because it moves first, but
          it isn't the whole picture — a member who attends every week and hasn't had
          a real conversation with anyone in a year is a resignation waiting to
          surprise you.
        </p>
        <WeightTable rows={MEMBER_INPUTS} />

        <h2 className="mt-12 text-xl font-semibold text-ink-900 dark:text-ink-100">
          What we measure about a club
        </h2>
        <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">
          Also out of 100. The last line is the one clubs find most useful: it asks
          whether you acted on what you already knew.
        </p>
        <WeightTable rows={CLUB_INPUTS} />

        <h2 className="mt-12 text-xl font-semibold text-ink-900 dark:text-ink-100">
          What you get on Monday
        </h2>
        <p className="mt-2 text-pretty text-ink-600 dark:text-ink-400">
          At most {WEEKLY_SIGNAL_CAP} things, ranked. Not a dashboard — a short list
          where each item names one person, one reason, and one thing to do. A guest
          who visited and heard nothing back outranks almost everything else, because
          that window closes fastest.
        </p>
        <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
          We deliberately don't send more. A list of forty is a backlog, and a backlog
          gets closed rather than worked. Everything under the cut is still on the
          member's own page whenever you want it.
        </p>

        <h2 className="mt-12 text-xl font-semibold text-ink-900 dark:text-ink-100">
          What it will never do
        </h2>
        <ul className="mt-3 space-y-2 text-ink-700 dark:text-ink-300">
          <li className="text-pretty">
            Email a member on its own. Every message is drafted for a person to read,
            edit and send.
          </li>
          <li className="text-pretty">
            Score anyone with a model. The rules are fixed and published on this page.
          </li>
          <li className="text-pretty">
            Tell a club it is failing. It reports what it measured and what it doesn't
            know.
          </li>
          <li className="text-pretty">
            Share a member's name outside the club. District rollups are counts;
            cross-club sharing strips anything identifying before it leaves.
          </li>
        </ul>

        <h2 className="mt-12 text-xl font-semibold text-ink-900 dark:text-ink-100">Questions</h2>
        <dl className="mt-6 space-y-7">
          {FAQS.map((f) => (
            <div key={f.q}>
              <dt className="font-medium text-ink-900 dark:text-ink-100">{f.q}</dt>
              <dd className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">{f.a}</dd>
            </div>
          ))}
        </dl>

        <Link
          to="/pricing"
          prefetch="intent"
          className="mt-12 inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
        >
          See pricing
        </Link>
      </article>
    </>
  );
}

function WeightTable({ rows }: { rows: { label: string; weight: number }[] }) {
  return (
    <table className="mt-5 w-full text-left text-sm">
      <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="py-2.5 text-pretty text-ink-700 dark:text-ink-300">{r.label}</td>
            <td className="w-20 py-2.5 text-right tabular-nums text-ink-500">{r.weight} pts</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
