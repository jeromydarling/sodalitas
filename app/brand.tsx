/**
 * brand.tsx — the logo, the icon set, and the motion primitive.
 *
 * Everything here is hand-authored SVG. No icon package: a dependency that
 * ships a thousand glyphs to render the twenty we use is a poor trade on a
 * Worker, where the bundle is the cold start. These are drawn on the same 24px
 * grid with the same 1.75 stroke, so they sit together without looking
 * assembled from three different sets.
 *
 * All of it inherits `currentColor` and sizes from `em`, so an icon beside text
 * matches that text in both themes without being told anything.
 */

import type { ReactNode, SVGProps } from "react";

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

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Svg({ children, title, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.25em"
      height="1.25em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default. An icon beside its own label read aloud twice is
      // worse than one that isn't read at all.
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const Icon = {
  /** Someone drifting — the falling line that is the whole product. */
  Drift: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 6l5 5 4-3 4 4 5-7" />
      <circle cx="21" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M3 20h18" opacity={0.35} />
    </Svg>
  ),
  People: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3.2 3.2 0 0 1 0 6.2" opacity={0.6} />
      <path d="M17.5 14.4A6 6 0 0 1 21 20" opacity={0.6} />
    </Svg>
  ),
  Guest: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="10" cy="8" r="3.2" />
      <path d="M4 20a6 6 0 0 1 12 0" />
      <path d="M19 7v6M22 10h-6" />
    </Svg>
  ),
  Calendar: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  Handover: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 8h11l-2.5-2.5M20 16H9l2.5 2.5" />
      <circle cx="18.5" cy="8" r="2" />
      <circle cx="5.5" cy="16" r="2" />
    </Svg>
  ),
  Dues: (p: IconProps) => (
    <Svg {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6.5 14.5h3" />
    </Svg>
  ),
  Project: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.4 6.7 19.2l1.1-5.9L3.5 9.2l5.9-.8z" />
    </Svg>
  ),
  Committee: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="6" r="2.6" />
      <circle cx="5.5" cy="17" r="2.6" />
      <circle cx="18.5" cy="17" r="2.6" />
      <path d="M12 8.6v3.9M10 13.5L7.2 15M14 13.5l2.8 1.5" opacity={0.6} />
    </Svg>
  ),
  District: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </Svg>
  ),
  Mail: (p: IconProps) => (
    <Svg {...p}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M3.5 7.5l7.3 5a2 2 0 0 0 2.4 0l7.3-5" />
    </Svg>
  ),
  Import: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3v11m0 0l-3.5-3.5M12 14l3.5-3.5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Svg>
  ),
  Shield: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3l7.5 3v6c0 4.6-3.1 7.9-7.5 9.4C7.6 19.9 4.5 16.6 4.5 12V6z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </Svg>
  ),
  Check: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />
    </Svg>
  ),
  Cross: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  Dash: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 12h12" />
    </Svg>
  ),
  Arrow: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 12h15m0 0l-5.5-5.5M19 12l-5.5 5.5" />
    </Svg>
  ),
  Book: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 4.5h6a2.5 2.5 0 0 1 2 2.5v12a2 2 0 0 0-2-1.5H4z" />
      <path d="M20 4.5h-6a2.5 2.5 0 0 0-2 2.5v12a2 2 0 0 1 2-1.5h6z" />
    </Svg>
  ),
  Plug: (p: IconProps) => (
    <Svg {...p}>
      <path d="M9 3v5M15 3v5" />
      <path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 16.5V21" />
    </Svg>
  ),
  Spark: (p: IconProps) => (
    <Svg {...p}>
      <path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" opacity={0.6} />
    </Svg>
  ),
  Clock: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.3 2" />
    </Svg>
  ),
  Menu: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
  Close: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
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
