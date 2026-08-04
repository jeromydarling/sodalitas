/**
 * screens.tsx — miniature product screenshots, built from real DOM.
 *
 * Not images. Every one of these is React and CSS, which buys four things a
 * PNG doesn't: the text is selectable and indexable, it renders correctly in
 * both light and dark themes without a second asset, it stays crisp at any
 * density, and it costs a few hundred bytes instead of a few hundred kilobytes.
 *
 * The frame is deliberately chromeless — no fake address bar, no traffic-light
 * dots. Those say "here is a picture of a website"; this product is a tool
 * somebody works in, and a plain window with a title strip says that instead.
 *
 * ## The honesty rule
 *
 * These mirror the real screens closely — the same columns, the same status
 * vocabulary, the same tone of voice. Where they simplify, they simplify by
 * *removing* rather than by inventing: fewer rows, not extra features. Nothing
 * here shows a capability that doesn't exist, because a prospect who signs up
 * expecting a chart they saw on the marketing site has been sold something.
 *
 * The names are the demo club's, so a visitor who clicks through to the demo
 * meets the same people.
 */

import type { ReactNode } from "react";
import { Icon } from "~/brand";

// ── The frame ─────────────────────────────────────────────────────────────────

export function Frame({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm dark:border-ink-800 dark:bg-ink-900 ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-ink-200 bg-ink-50/70 px-3.5 py-2 dark:border-ink-800 dark:bg-ink-950/40">
        <span className="text-[11px] font-medium tracking-wide text-ink-500">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** Status pill, matching the app's own tone vocabulary. */
function Pill({ tone, children }: { tone: "steady" | "watch" | "risk" | "neutral"; children: ReactNode }) {
  const tones = {
    steady: "bg-steady-500/12 text-steady-500",
    watch: "bg-watch-500/15 text-watch-500",
    risk: "bg-risk-500/12 text-risk-500",
    neutral: "bg-ink-500/10 text-ink-600 dark:text-ink-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

// ── This week's signals ───────────────────────────────────────────────────────

/**
 * The screen the product is for.
 *
 * Each row carries its evidence, because a list of names with no reasons is
 * exactly the thing this replaces.
 */
const SIGNALS = [
  {
    tone: "risk" as const,
    name: "David Whitfield",
    headline: "Here, but not really in",
    why: "Attends most weeks · on no committee · nobody has spoken to him since March",
    todo: "Ask him to help with the coat drive",
  },
  {
    tone: "watch" as const,
    name: "Priya Raman",
    headline: "Away a while",
    why: "Last attended 7 weeks ago · was at 90% before that",
    todo: "A short call, no agenda",
  },
  {
    tone: "watch" as const,
    name: "Tom Alderman",
    headline: "Visited twice, heard nothing back",
    why: "Guest of Margaret Okonkwo · no follow-up recorded",
    todo: "Margaret to invite him to Thursday",
  },
];

export function SignalsScreen({ className = "" }: { className?: string }) {
  return (
    <Frame title="This week — 3 of 7" className={className}>
      <ul className="divide-y divide-ink-200 dark:divide-ink-800">
        {SIGNALS.map((s) => (
          <li key={s.name} className="p-3.5">
            <div className="flex items-center gap-2">
              <Pill tone={s.tone}>{s.tone === "risk" ? "At risk" : "Watch"}</Pill>
              <span className="truncate text-sm font-medium text-ink-900 dark:text-ink-100">
                {s.name}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-ink-800 dark:text-ink-200">{s.headline}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{s.why}</p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-brand-600">
              <Icon.Arrow width="0.9em" height="0.9em" />
              {s.todo}
            </p>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

// ── The roster ────────────────────────────────────────────────────────────────

const MEMBERS = [
  { name: "Margaret Okonkwo", role: "Banking", last: "This week", tone: "steady" as const, state: "Steady" },
  { name: "David Whitfield", role: "Insurance", last: "6 days", tone: "risk" as const, state: "At risk" },
  { name: "Ana Beltrán", role: "Dentistry", last: "This week", tone: "steady" as const, state: "Steady" },
  { name: "Priya Raman", role: "Architecture", last: "7 weeks", tone: "watch" as const, state: "Watch" },
  { name: "Joe Hallam", role: "Haulage", last: "2 weeks", tone: "steady" as const, state: "Steady" },
];

export function RosterScreen({ className = "" }: { className?: string }) {
  return (
    <Frame title="Members — 46" className={className}>
      <div className="flex items-center gap-2 border-b border-ink-200 px-3.5 py-2 dark:border-ink-800">
        <Icon.Search width="0.9em" height="0.9em" className="text-ink-400" />
        <span className="text-[11px] text-ink-400">Search by name, email or employer</span>
      </div>
      <table className="w-full text-left">
        <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
          {MEMBERS.map((m) => (
            <tr key={m.name}>
              <td className="px-3.5 py-2.5">
                <div className="text-[13px] font-medium text-ink-900 dark:text-ink-100">
                  {m.name}
                </div>
                <div className="text-[11px] text-ink-500">{m.role}</div>
              </td>
              <td className="px-2 py-2.5 text-right text-[11px] whitespace-nowrap text-ink-500">
                {m.last}
              </td>
              <td className="px-3.5 py-2.5 text-right">
                <Pill tone={m.tone}>{m.state}</Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

// ── Attendance ────────────────────────────────────────────────────────────────

export function MeetingScreen({ className = "" }: { className?: string }) {
  const present = [true, true, false, true, true, true, true, false, true, true, true, true];
  return (
    <Frame title="Thursday 14 August — Blue Water Grill" className={className}>
      <div className="border-b border-ink-200 px-3.5 py-2.5 dark:border-ink-800">
        <div className="text-[13px] font-medium text-ink-900 dark:text-ink-100">
          Speaker: Lakeside Food Bank
        </div>
        <div className="text-[11px] text-ink-500">Where the winter appeal went</div>
      </div>
      <div className="p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-ink-600 dark:text-ink-400">Attendance</span>
          <span className="text-[11px] tabular-nums text-ink-500">38 of 46 · 2 guests</span>
        </div>
        {/* A presence grid rather than a list: the shape of a room, at a glance. */}
        <div className="mt-2.5 grid grid-cols-12 gap-1">
          {Array.from({ length: 46 }, (_, i) => (
            <span
              key={i}
              className={`h-3.5 rounded-[3px] ${
                present[i % present.length]
                  ? "bg-steady-500/50"
                  : "bg-ink-200 dark:bg-ink-800"
              }`}
            />
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink-500">
          Marked in one pass. Everything else is worked out from this.
        </p>
      </div>
    </Frame>
  );
}

// ── Dues ──────────────────────────────────────────────────────────────────────

const INVOICES = [
  { name: "Margaret Okonkwo", amount: "$150.00", tone: "steady" as const, state: "Paid" },
  { name: "David Whitfield", amount: "$150.00", tone: "watch" as const, state: "Past due" },
  { name: "Ana Beltrán", amount: "$150.00", tone: "steady" as const, state: "Paid" },
  { name: "Joe Hallam", amount: "$75.00", tone: "neutral" as const, state: "Part paid" },
];

export function DuesScreen({ className = "" }: { className?: string }) {
  return (
    <Frame title="Dues — 2026–27 first half" className={className}>
      <div className="grid grid-cols-3 divide-x divide-ink-200 border-b border-ink-200 dark:divide-ink-800 dark:border-ink-800">
        {[
          ["Billed", "$6,900"],
          ["Come in", "$5,850"],
          ["Past due", "4"],
        ].map(([label, value], i) => (
          <div key={label} className="px-3.5 py-2.5">
            <div
              className={`text-base font-semibold tabular-nums ${
                i === 2 ? "text-watch-500" : "text-ink-900 dark:text-ink-100"
              }`}
            >
              {value}
            </div>
            <div className="text-[10px] text-ink-500">{label}</div>
          </div>
        ))}
      </div>
      <table className="w-full text-left">
        <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
          {INVOICES.map((r) => (
            <tr key={r.name}>
              <td className="px-3.5 py-2 text-[13px] text-ink-800 dark:text-ink-200">{r.name}</td>
              <td className="px-2 py-2 text-right text-[12px] tabular-nums text-ink-600 dark:text-ink-400">
                {r.amount}
              </td>
              <td className="px-3.5 py-2 text-right">
                <Pill tone={r.tone}>{r.state}</Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-ink-200 px-3.5 py-2.5 text-[11px] text-ink-500 dark:border-ink-800">
        Past due is usually a symptom. Worth a call, not another reminder.
      </p>
    </Frame>
  );
}

// ── Club health ───────────────────────────────────────────────────────────────

export function HealthScreen({ className = "" }: { className?: string }) {
  const drivers = [
    ["Attendance", 82],
    ["Involvement", 61],
    ["Guests in pipeline", 74],
    ["Dues current", 91],
    ["Followed up", 45],
  ] as const;

  return (
    <Frame title="Club health" className={className}>
      <div className="flex items-baseline gap-2 border-b border-ink-200 px-3.5 py-3 dark:border-ink-800">
        <span className="text-2xl font-semibold tabular-nums text-ink-900 dark:text-ink-50">71</span>
        <span className="text-[11px] text-ink-500">out of 100 · up 4 since June</span>
      </div>
      <div className="space-y-2.5 p-3.5">
        {drivers.map(([label, value]) => (
          <div key={label}>
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-ink-600 dark:text-ink-400">{label}</span>
              <span className="tabular-nums text-ink-500">{value}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
              <div
                className={`h-full rounded-full ${
                  value >= 70 ? "bg-steady-500" : value >= 55 ? "bg-watch-500" : "bg-risk-500"
                }`}
                style={{ width: `${value}%` }}
              />
            </div>
          </div>
        ))}
        {/* The driver breakdown is the point: a score you can argue with. */}
        <p className="pt-1 text-[11px] text-ink-500">
          Every score shows its drivers. Disagree and dismiss one, and the reason is kept.
        </p>
      </div>
    </Frame>
  );
}

// ── Committees ────────────────────────────────────────────────────────────────

const COMMITTEES = [
  { name: "Membership", chair: "Margaret Okonkwo", seats: "6 of 6" },
  { name: "Service projects", chair: "Ana Beltrán", seats: "8 of 9" },
  { name: "Programme", chair: "Joe Hallam", seats: "4 of 5" },
  { name: "Foundation", chair: "—", seats: "2 of 5" },
];

export function CommitteeScreen({ className = "" }: { className?: string }) {
  return (
    <Frame title="Committees" className={className}>
      <table className="w-full text-left">
        <tbody className="divide-y divide-ink-200 dark:divide-ink-800">
          {COMMITTEES.map((c) => (
            <tr key={c.name}>
              <td className="px-3.5 py-2.5">
                <div className="text-[13px] font-medium text-ink-900 dark:text-ink-100">
                  {c.name}
                </div>
                <div className="text-[11px] text-ink-500">
                  {c.chair === "—" ? "No chair yet" : `Chair: ${c.chair}`}
                </div>
              </td>
              <td className="px-3.5 py-2.5 text-right text-[11px] whitespace-nowrap text-ink-500">
                {c.seats}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* The number that predicts next year's resignations. */}
      <div className="flex items-center gap-2 border-t border-ink-200 px-3.5 py-2.5 dark:border-ink-800">
        <Icon.Drift width="0.9em" height="0.9em" className="text-watch-500" />
        <span className="text-[11px] text-ink-600 dark:text-ink-400">
          11 members are on no committee at all
        </span>
      </div>
    </Frame>
  );
}
