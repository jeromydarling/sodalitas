/**
 * brand.tsx — the logo, the icon set, and the motion primitive.
 *
 * Icons are Lucide, mapped to names that mean something in this product rather
 * than something in a glyph catalogue: `Icon.Drift`, not `Icon.TrendingDown`.
 * Call sites then read as what they are, and swapping the underlying glyph is
 * a one-line change here instead of a search across forty files.
 *
 * Lucide is tree-shaken per import, so the bundle carries the two dozen we
 * actually use rather than the whole set. Every one is wrapped so it inherits
 * `currentColor` and sizes in `em` — an icon beside text matches that text, in
 * both themes, without being told anything.
 *
 * The logo below stays hand-drawn. It's the one mark that has to be ours.
 */

import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  TrendingDown, Users, UserPlus, CalendarDays, Repeat, CreditCard, HandHeart,
  Network, Globe2, Mail, Upload, ShieldCheck, Check, X, Minus, ArrowRight,
  BookOpen, Plug, Sparkles, Clock, Menu as MenuIcon, Building2, ClipboardList,
  ChartNoAxesColumn, Search, Bell, Settings2, Quote,
} from "lucide-react";

// ── Logo ──────────────────────────────────────────────────────────────────────

/**
 * The mark: a ring of six linked members around a held centre.
 *
 * Rotary's own wheel is trademarked and not ours to wear, so this is a
 * deliberate cousin rather than an imitation — a fellowship seen from above,
 * which is what the name means. The gap in the ring is the point: a circle with
 * a member missing, which is the entire problem the product exists for.
 */
export function Logo({ className = "", title = "Sodalitas" }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* The ring, opened at the top right — the seat nobody filled. */}
      <path
        d="M22.8 5.4A13 13 0 1 1 16 3"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="text-brand-600 dark:text-brand-500"
      />
      {/* Members, evenly spaced, one of them gold: the person being kept. */}
      <circle cx="16" cy="7" r="2.6" className="fill-brand-600 dark:fill-brand-500" />
      <circle cx="24" cy="20.5" r="2.6" className="fill-brand-600 dark:fill-brand-500" />
      <circle cx="8" cy="20.5" r="2.6" className="fill-gold-500" />
      <circle cx="16" cy="16" r="1.6" className="fill-ink-400" />
    </svg>
  );
}

/** The mark plus the word, for headers and footers. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo className="h-7 w-7" />
      <span className="text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
        Sodalitas
      </span>
    </span>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

type LucideLike = ComponentType<SVGProps<SVGSVGElement> & { size?: string | number }>;
export type IconProps = SVGProps<SVGSVGElement> & { title?: string };

/**
 * Wrap a Lucide glyph so it behaves like text.
 *
 * Sized in `em` rather than pixels, so an icon in a heading grows with the
 * heading. Decorative by default — an icon sitting beside its own label and
 * read aloud twice is worse than one that isn't read at all — and given a
 * `title` only when it carries meaning nothing else on screen does.
 */
function icon(Glyph: LucideLike, name: string) {
  const Wrapped = ({ title, ...props }: IconProps) => (
    <Glyph
      width="1.25em"
      height="1.25em"
      strokeWidth={1.75}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      {...props}
    />
  );
  Wrapped.displayName = `Icon.${name}`;
  return Wrapped;
}

export const Icon = {
  /** A member pulling away. The one this product exists for. */
  Drift: icon(TrendingDown, "Drift"),
  People: icon(Users, "People"),
  Guest: icon(UserPlus, "Guest"),
  Calendar: icon(CalendarDays, "Calendar"),
  /** The July turnover. */
  Handover: icon(Repeat, "Handover"),
  Dues: icon(CreditCard, "Dues"),
  Project: icon(HandHeart, "Project"),
  Committee: icon(Network, "Committee"),
  District: icon(Globe2, "District"),
  Mail: icon(Mail, "Mail"),
  Import: icon(Upload, "Import"),
  Shield: icon(ShieldCheck, "Shield"),
  Check: icon(Check, "Check"),
  Cross: icon(X, "Cross"),
  Dash: icon(Minus, "Dash"),
  Arrow: icon(ArrowRight, "Arrow"),
  Book: icon(BookOpen, "Book"),
  Plug: icon(Plug, "Plug"),
  Spark: icon(Sparkles, "Spark"),
  Clock: icon(Clock, "Clock"),
  Menu: icon(MenuIcon, "Menu"),
  Close: icon(X, "Close"),
  Club: icon(Building2, "Club"),
  Task: icon(ClipboardList, "Task"),
  Chart: icon(ChartNoAxesColumn, "Chart"),
  Search: icon(Search, "Search"),
  Bell: icon(Bell, "Bell"),
  Settings: icon(Settings2, "Settings"),
  Quote: icon(Quote, "Quote"),
} as const;

export type IconName = keyof typeof Icon;

// ── Motion ────────────────────────────────────────────────────────────────────

/**
 * Reveal on scroll.
 *
 * CSS-only, using `animation-timeline: view()` where it exists, so there is no
 * JavaScript, no IntersectionObserver, and nothing to hydrate — the content is
 * in the server-rendered HTML and visible whether or not the animation ever
 * runs. Browsers without scroll-driven animations simply see the finished
 * state, which is the correct fallback and needs no feature detection.
 *
 * `prefers-reduced-motion` is honoured globally in app.css.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  /** Stagger, in steps of roughly 60ms. Keep it under 4 or it reads as slow. */
  delay?: 0 | 1 | 2 | 3;
  className?: string;
}) {
  return <div className={`reveal reveal-${delay} ${className}`}>{children}</div>;
}

/** A quiet label above a section heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-500">
      {children}
    </p>
  );
}
