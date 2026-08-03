/**
 * ui.tsx — the small set of pieces every screen is built from.
 *
 * Deliberately tiny and unabstracted. A club officer's screen is a table, a
 * form and a few status chips; wiring in a component library would cost more
 * in bundle size and indirection than it saves in typing.
 */

import { Link } from "react-router";
import type { ReactNode } from "react";

// ── Page furniture ────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">{title}</h1>
        {subtitle && <p className="mt-1 text-pretty text-ink-600 dark:text-ink-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-ink-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * An empty state that says what to do next.
 *
 * Never "No results." A screen with nothing on it is the moment someone decides
 * whether the product is worth the effort, and a full stop is the wrong answer.
 */
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 px-6 py-12 text-center dark:border-ink-700">
      <p className="font-medium text-ink-800 dark:text-ink-200">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-pretty text-ink-600 dark:text-ink-400">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Buttons and links ─────────────────────────────────────────────────────────

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60";

const VARIANTS = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary:
    "border border-ink-300 text-ink-800 hover:border-ink-400 dark:border-ink-700 dark:text-ink-200",
  quiet: "text-ink-600 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...props} className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} />;
}

export function ButtonLink({
  to,
  variant = "primary",
  className = "",
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} prefetch="intent" className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

// ── Status ────────────────────────────────────────────────────────────────────

const TONES = {
  steady: "bg-steady-500/12 text-steady-500",
  watch: "bg-watch-500/15 text-watch-500",
  risk: "bg-risk-500/12 text-risk-500",
  neutral: "bg-ink-500/10 text-ink-600 dark:text-ink-300",
  brand: "bg-brand-500/12 text-brand-600",
} as const;

export type Tone = keyof typeof TONES;

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Health and risk share a vocabulary, so they share a mapping. */
export function toneFor(status: string): Tone {
  switch (status) {
    case "healthy":
    case "steady":
      return "steady";
    case "watch":
      return "watch";
    case "at_risk":
    case "urgent":
      return "risk";
    default:
      return "neutral";
  }
}

export function statusLabel(status: string): string {
  return (
    {
      healthy: "Healthy",
      watch: "Worth watching",
      at_risk: "Needs attention",
      steady: "Steady",
    }[status] ?? status.replace(/_/g, " ")
  );
}

// ── Tables ────────────────────────────────────────────────────────────────────

export function Table({ children }: { children: ReactNode }) {
  return (
    // Wide tables scroll inside their own container rather than pushing the
    // page sideways on a phone.
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      className={`border-b border-ink-200 pb-2 text-xs font-medium tracking-wide text-ink-500 uppercase dark:border-ink-800 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <td className={`border-b border-ink-100 py-2.5 dark:border-ink-800/60 ${className}`}>
      {children}
    </td>
  );
}

// ── Forms ─────────────────────────────────────────────────────────────────────

export function Field({
  label,
  name,
  hint,
  error,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-ink-800 dark:text-ink-200">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {error && (
        <p id={`${name}-error`} className="mt-1.5 text-sm text-risk-500">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT =
  "w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 " +
  "placeholder:text-ink-400 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${INPUT} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${INPUT} ${props.className ?? ""}`} />;
}

// ── Dates ─────────────────────────────────────────────────────────────────────

/**
 * Dates render on the server, so they must not depend on the viewer's clock or
 * locale — an SSR/client mismatch here shows up as a hydration warning and a
 * flicker. Fixed format, UTC, no surprises.
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "—";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "11 days ago", for anything where the gap matters more than the date. */
export function relativeDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "never";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 60) return "about a month ago";
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? "about a year ago" : `${years} years ago`;
}

export function money(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  const sign = cents < 0 ? "−" : "";
  return rest === 0
    ? `${sign}$${dollars.toLocaleString("en-US")}`
    : `${sign}$${dollars.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}
