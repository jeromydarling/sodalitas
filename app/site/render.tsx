/**
 * render.tsx — turning a club's blocks into their website.
 *
 * The whole renderer is one switch. There is no `dangerouslySetInnerHTML`
 * anywhere in it and there is no code path that produces one, which is the
 * property that lets a language model write a club's home page.
 *
 * Styling is the club's brand tokens as CSS custom properties on the outer
 * element, referenced by Tailwind arbitrary values. That means one stylesheet
 * for every club, no per-club CSS to generate or cache, and a palette change
 * that takes effect on the next request. It also means the tokens never become
 * a stylesheet *string* — they go into React's `style` prop, which escapes
 * them, so a token that somehow got past validation still cannot close a
 * declaration and open a script tag.
 */

import { Form, Link } from "react-router";
import type { ReactNode } from "react";
import {
  paragraphs,
  safeHref,
  videoEmbedSrc,
  type Block,
} from "@domain/blocks";
import { tokensToStyle, type BrandTokens } from "@domain/palette";
import type { ThemeKey } from "@content/rotary";
import {
  CalendarDays, Users, Heart, Globe, Handshake, Award, BookOpen, Leaf,
  Droplet, GraduationCap, Stethoscope, Home, UtensilsCrossed, Megaphone,
  MapPin, Clock, Mail, Phone, Sparkles, CircleDot, ArrowRight, Quote,
  Ticket, FileText, Download,
} from "lucide-react";

// ── Icons ─────────────────────────────────────────────────────────────────────

const ICONS: Record<string, typeof CalendarDays> = {
  calendar: CalendarDays,
  users: Users,
  heart: Heart,
  globe: Globe,
  handshake: Handshake,
  award: Award,
  book: BookOpen,
  leaf: Leaf,
  droplet: Droplet,
  graduation: GraduationCap,
  stethoscope: Stethoscope,
  home: Home,
  utensils: UtensilsCrossed,
  megaphone: Megaphone,
  "map-pin": MapPin,
  clock: Clock,
  mail: Mail,
  phone: Phone,
  sparkles: Sparkles,
  ticket: Ticket,
  "file-text": FileText,
  // The wheel, standing in for the Rotary emblem we're not licensed to draw.
  wheel: CircleDot,
};

function BlockIcon({ name, className = "" }: { name: unknown; className?: string }) {
  const Glyph = typeof name === "string" ? ICONS[name] : undefined;
  if (!Glyph) return null;
  return <Glyph className={className} strokeWidth={1.75} aria-hidden />;
}

// ── What a page needs to render ───────────────────────────────────────────────

export interface SiteMedia {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface LiveMeeting {
  date: string;
  time: string | null;
  location: string | null;
  topic: string | null;
  speaker: string | null;
}

export interface LiveProject {
  name: string;
  summary: string | null;
  area: string | null;
}

export interface LiveEvent {
  slug: string;
  title: string;
  summary: string | null;
  date: string;
  time: string | null;
  location: string | null;
  /** The cheapest ticket, in cents. Null when the event has no tickets yet. */
  fromCents: number | null;
  full: boolean;
}

export interface LiveDocument {
  id: string;
  title: string;
  size: string;
  folder: string | null;
  yearTag: string | null;
}

export interface RenderContext {
  club: { name: string; slug: string; city: string | null; state: string | null };
  /** Path prefix for links. "" on a club's own domain, "/club/slug" on ours. */
  base: string;
  meetings: LiveMeeting[];
  projects: LiveProject[];
  events: LiveEvent[];
  documents: LiveDocument[];
  officers: { name: string; office: string }[];
  donations: {
    amounts: number[];
    coverFeeDefault: boolean;
    blurb: string | null;
  } | null;
  media: Map<string, SiteMedia>;
  /** The result of the last form post on this page, if there was one. */
  formState: { ok: boolean; message: string } | null;
  submitting: boolean;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

/** Dates render on the server, so no locale and no viewer clock. */
function formatDate(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return date;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// ── Small pieces ──────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

/**
 * Resolve a link within the site.
 *
 * A block's `/visit` means "the visit page of this site", which is `/visit` on
 * the club's own domain and `/club/lakeside/visit` on ours. Getting this wrong
 * is how a club's own domain ends up linking back to sodalitas.app.
 */
function href(value: unknown, base: string): string {
  const safe = safeHref(value);
  if (!safe) return "";
  if (safe.startsWith("/")) return `${base}${safe === "/" ? "" : safe}` || "/";
  return safe;
}

function Cta({
  label,
  to,
  base,
  tone = "brand",
}: {
  label: unknown;
  to: unknown;
  base: string;
  tone?: "brand" | "accent" | "quiet";
}) {
  const text = str(label);
  const target = href(to, base);
  if (!text || !target) return null;

  const cls =
    tone === "brand"
      ? "bg-[var(--site-brand-solid)] text-[var(--site-on-brand)] hover:opacity-90"
      : tone === "accent"
        ? "bg-[var(--site-accent-solid)] text-[var(--site-on-accent)] hover:opacity-90"
        : "border border-[var(--site-ink-300)] text-[var(--site-ink-900)] hover:border-[var(--site-ink-500)]";

  const inner = (
    <>
      {text}
      {tone !== "quiet" && <ArrowRight className="size-4" strokeWidth={2} aria-hidden />}
    </>
  );
  const className = `inline-flex items-center gap-2 rounded-[var(--site-radius)] px-5 py-2.5 text-[0.95rem] font-medium transition ${cls}`;

  return target.startsWith("/") ? (
    <Link to={target} prefetch="intent" className={className}>
      {inner}
    </Link>
  ) : (
    <a href={target} className={className} rel="noopener">
      {inner}
    </a>
  );
}

function Heading({ children, level = 2 }: { children: ReactNode; level?: 2 | 3 }) {
  if (!children) return null;
  const cls =
    level === 2
      ? "font-[family-name:var(--site-font-display)] text-[clamp(1.6rem,3.5vw,2.35rem)] leading-[1.15] font-semibold tracking-[-0.015em] text-[var(--site-ink-900)]"
      : "font-[family-name:var(--site-font-display)] text-xl font-semibold text-[var(--site-ink-900)]";
  return level === 2 ? <h2 className={cls}>{children}</h2> : <h3 className={cls}>{children}</h3>;
}

function Prose({ text, className = "" }: { text: unknown; className?: string }) {
  const parts = paragraphs(text);
  if (parts.length === 0) return null;
  return (
    <div className={`space-y-4 text-[1.05rem] leading-[1.7] text-pretty text-[var(--site-ink-700)] ${className}`}>
      {parts.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function Picture({ media, className = "" }: { media: SiteMedia | undefined; className?: string }) {
  if (!media) return null;
  return (
    <img
      src={media.url}
      // Empty rather than the filename when nobody wrote alt text. A screen
      // reader announcing "IMG_4471.jpg" is worse than announcing nothing.
      alt={media.alt}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
}

/** Section wrapper. `--site-space` lets the density token widen everything. */
function Section({
  children,
  tone = "plain",
  id,
}: {
  children: ReactNode;
  tone?: "plain" | "tint" | "brand" | "accent";
  id?: string;
}) {
  const bg =
    tone === "tint"
      ? "bg-[var(--site-ink-50)]"
      : tone === "brand"
        ? "bg-[var(--site-brand-solid)] text-[var(--site-on-brand)]"
        : tone === "accent"
          ? "bg-[var(--site-accent-solid)] text-[var(--site-on-accent)]"
          : "";
  return (
    <section
      id={id}
      className={`px-6 py-[calc(3.5rem*var(--site-space))] sm:px-8 ${bg}`}
    >
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  );
}

// ── The blocks ────────────────────────────────────────────────────────────────

function HeroBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const media = ctx.media.get(str(block.mediaId));
  const chosen = str(block.layout) || "split";
  // A split hero with nothing to put in the other half is just a narrow
  // column of text against a large empty rectangle — which is what a club that
  // has not uploaded a photograph yet would see on their front page. Centre it
  // instead; that reads as a decision rather than as a missing image.
  const layout = chosen === "split" && !media ? "centred" : chosen;
  const centred = layout === "centred" || layout === "banner";

  const words = (
    <div className={centred ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      {str(block.eyebrow) && (
        <p className="mb-3 text-sm font-medium tracking-wide text-[var(--site-brand-700)] uppercase">
          {str(block.eyebrow)}
        </p>
      )}
      <h1 className="font-[family-name:var(--site-font-display)] text-[clamp(2rem,5.5vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-[var(--site-ink-900)]">
        {str(block.heading)}
      </h1>
      <Prose text={block.body} className="mt-5" />
      <div className={`mt-8 flex flex-wrap gap-3 ${centred ? "justify-center" : ""}`}>
        <Cta label={block.ctaLabel} to={block.ctaHref} base={ctx.base} />
        <Cta label={block.secondaryLabel} to={block.secondaryHref} base={ctx.base} tone="quiet" />
      </div>
    </div>
  );

  if (layout === "banner" && media) {
    return (
      <section className="relative isolate overflow-hidden">
        <Picture media={media} className="absolute inset-0 -z-10 size-full object-cover" />
        {/* A scrim rather than a filter: the text has to pass contrast against
            the darkest thing behind it, and a photograph is not predictable. */}
        <div className="absolute inset-0 -z-10 bg-[var(--site-ink-900)]/65" />
        <div className="mx-auto w-full max-w-5xl px-6 py-[calc(6rem*var(--site-space))] text-center [&_*]:!text-white">
          {words}
        </div>
      </section>
    );
  }

  if (layout === "split" && media) {
    return (
      <Section>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {words}
          <Picture
            media={media}
            className="w-full rounded-[calc(var(--site-radius)*1.6)] object-cover shadow-sm lg:aspect-[4/3]"
          />
        </div>
      </Section>
    );
  }

  return <Section>{words}</Section>;
}

function MeetingsBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const count = num(block.count, 4);
  const meetings = ctx.meetings.slice(0, count);

  return (
    <Section tone="tint">
      <Heading>{str(block.heading) || "Coming up"}</Heading>
      <Prose text={block.intro} className="mt-3 max-w-2xl" />

      {meetings.length === 0 ? (
        <p className="mt-6 text-[var(--site-ink-600)]">
          {str(block.emptyText) || "Nothing on the calendar just now. Get in touch and we'll let you know when we next meet."}
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[var(--site-ink-200)]">
          {meetings.map((m, i) => (
            <li key={`${m.date}-${i}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4">
              <span className="min-w-32 font-medium text-[var(--site-ink-900)]">
                {formatDate(m.date)}
                {m.time && <span className="font-normal text-[var(--site-ink-500)]"> · {m.time}</span>}
              </span>
              <span className="flex-1 text-[var(--site-ink-700)]">
                {block.showSpeaker !== false && (m.topic || m.speaker)
                  ? [m.topic, m.speaker].filter(Boolean).join(" — ")
                  : null}
              </span>
              {block.showLocation !== false && m.location && (
                <span className="inline-flex items-center gap-1.5 text-sm text-[var(--site-ink-500)]">
                  <MapPin className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {m.location}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * What's on.
 *
 * Renders nothing when there is nothing on, unless the club wrote a line to
 * say so. An events section reading "no events" on a club's home page is worse
 * than no events section — it is a public statement that nothing is happening.
 */
function EventsBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const events = ctx.events.slice(0, num(block.count, 3));
  const empty = str(block.emptyText);
  if (events.length === 0 && !empty) return null;

  return (
    <Section tone="tint">
      <Heading>{str(block.heading) || "What's on"}</Heading>
      <Prose text={block.intro} className="mt-3 max-w-2xl" />

      {events.length === 0 ? (
        <p className="mt-6 text-[var(--site-ink-600)]">{empty}</p>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <li key={e.slug}>
              <Link
                to={`${ctx.base}/events/${e.slug}`}
                prefetch="intent"
                className="flex h-full flex-col rounded-[calc(var(--site-radius)*1.4)] border border-[var(--site-ink-200)] p-6 transition hover:border-[var(--site-ink-400)]"
              >
                <span className="text-xs font-medium tracking-wide text-[var(--site-brand-700)] uppercase">
                  {[formatDate(e.date), e.time].filter(Boolean).join(" · ")}
                </span>
                <span className="mt-2 font-[family-name:var(--site-font-display)] text-lg font-semibold text-[var(--site-ink-900)]">
                  {e.title}
                </span>
                {e.summary && (
                  <span className="mt-1.5 flex-1 text-[0.95rem] leading-relaxed text-[var(--site-ink-700)]">
                    {e.summary}
                  </span>
                )}
                <span className="mt-4 flex items-center gap-2 text-sm text-[var(--site-ink-500)]">
                  {e.location && <span>{e.location}</span>}
                  {block.showPrice !== false && e.fromCents !== null && (
                    <span className="ml-auto font-medium text-[var(--site-ink-700)]">
                      {e.fromCents === 0 ? "Free" : `From ${money(e.fromCents)}`}
                    </span>
                  )}
                </span>
                {e.full && (
                  <span className="mt-2 text-sm text-[var(--site-ink-500)]">
                    Full — waiting list open
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * The public shelf of the club's library.
 *
 * Only documents the library itself marked public ever reach here — the block
 * has no way to name a document, deliberately, so there is one control over
 * who can read what and it lives with the file rather than with the page.
 */
function DocumentsBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const wanted = str(block.folderSlug);
  const documents = ctx.documents
    .filter((d) => !wanted || d.folder === wanted)
    .slice(0, num(block.count, 6));
  if (documents.length === 0) return null;

  return (
    <Section>
      <Heading>{str(block.heading) || "Documents"}</Heading>
      <Prose text={block.intro} className="mt-3 max-w-2xl" />
      <ul className="mt-8 divide-y divide-[var(--site-ink-200)]">
        {documents.map((d) => (
          <li key={d.id}>
            <a
              href={`${ctx.base}/documents/${d.id}`}
              className="flex items-center gap-3 py-3.5 text-[var(--site-ink-800)] hover:text-[var(--site-brand-700)]"
            >
              <FileText className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="flex-1 font-medium">{d.title}</span>
              {d.yearTag && (
                <span className="text-sm text-[var(--site-ink-500)]">{d.yearTag}</span>
              )}
              {block.showSize !== false && (
                <span className="text-sm text-[var(--site-ink-500)]">{d.size}</span>
              )}
              <Download className="size-4 shrink-0 text-[var(--site-ink-400)]" strokeWidth={1.75} aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ProjectsBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const projects = ctx.projects.slice(0, num(block.count, 3));
  if (projects.length === 0) return null;

  return (
    <Section>
      <Heading>{str(block.heading) || "What we've been doing"}</Heading>
      <Prose text={block.intro} className="mt-3 max-w-2xl" />
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p, i) => (
          <article
            key={i}
            className="rounded-[calc(var(--site-radius)*1.4)] border border-[var(--site-ink-200)] p-6"
          >
            {block.showArea !== false && p.area && (
              <p className="mb-2 text-xs font-medium tracking-wide text-[var(--site-brand-700)] uppercase">
                {p.area}
              </p>
            )}
            <h3 className="font-[family-name:var(--site-font-display)] text-lg font-semibold text-[var(--site-ink-900)]">
              {p.name}
            </h3>
            {p.summary && <p className="mt-2 text-[var(--site-ink-600)]">{p.summary}</p>}
          </article>
        ))}
      </div>
    </Section>
  );
}

function OfficersBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  if (ctx.officers.length === 0) return null;
  return (
    <Section tone="tint">
      <Heading>{str(block.heading) || "This year's officers"}</Heading>
      <Prose text={block.intro} className="mt-3 max-w-2xl" />
      <dl className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {ctx.officers.map((o, i) => (
          <div key={i}>
            <dt className="text-sm text-[var(--site-ink-500)]">{o.office}</dt>
            <dd className="font-medium text-[var(--site-ink-900)]">{o.name}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function StatsBlock({ block }: { block: Block }) {
  const items = (block.items as { value: string; label: string; note: string }[]) ?? [];
  const shown = items.filter((i) => i.value || i.label);
  if (shown.length === 0) return null;

  // Written out rather than interpolated: Tailwind scans source text, so
  // `lg:grid-cols-${n}` produces a class that exists in the HTML and in no
  // stylesheet — the classic way a grid silently collapses in production.
  const grid =
    { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" }[
      shown.length
    ] ?? "sm:grid-cols-2";

  return (
    <Section>
      <Heading>{str(block.heading)}</Heading>
      <dl className={`mt-8 grid gap-8 ${grid}`}>
        {shown.map((item, i) => (
          <div key={i}>
            <dt className="font-[family-name:var(--site-font-display)] text-[clamp(2rem,5vw,3rem)] leading-none font-semibold text-[var(--site-brand-700)]">
              {item.value || "—"}
            </dt>
            <dd className="mt-2 text-[var(--site-ink-700)]">{item.label}</dd>
            {item.note && <p className="mt-1 text-sm text-[var(--site-ink-500)]">{item.note}</p>}
          </div>
        ))}
      </dl>
    </Section>
  );
}

function CardsBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const items = (block.items as { icon: string; title: string; body: string; href: string }[]) ?? [];
  if (items.length === 0) return null;
  const columns = num(block.columns, 3);
  const grid = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <Section>
      <Heading>{str(block.heading)}</Heading>
      <Prose text={block.intro} className="mt-3 max-w-2xl" />
      <div className={`mt-8 grid gap-6 ${grid}`}>
        {items.map((item, i) => {
          const to = href(item.href, ctx.base);
          const body = (
            <>
              {item.icon && (
                <span className="mb-4 inline-flex size-10 items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-brand-50)] text-[var(--site-brand-700)]">
                  <BlockIcon name={item.icon} className="size-5" />
                </span>
              )}
              <h3 className="font-[family-name:var(--site-font-display)] text-lg font-semibold text-[var(--site-ink-900)]">
                {item.title}
              </h3>
              {item.body && <p className="mt-2 text-[var(--site-ink-600)]">{item.body}</p>}
            </>
          );
          const cls = "block rounded-[calc(var(--site-radius)*1.4)] border border-[var(--site-ink-200)] p-6 transition hover:border-[var(--site-brand-300)]";
          if (!to) return <div key={i} className={cls}>{body}</div>;
          return to.startsWith("/") ? (
            <Link key={i} to={to} prefetch="intent" className={cls}>{body}</Link>
          ) : (
            <a key={i} href={to} rel="noopener" className={cls}>{body}</a>
          );
        })}
      </div>
    </Section>
  );
}

function GalleryBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const items = (block.items as { mediaId: string; caption: string }[]) ?? [];
  const pictures = items.map((i) => ({ media: ctx.media.get(i.mediaId), caption: i.caption }))
    .filter((p) => p.media);
  if (pictures.length === 0) return null;
  const columns = num(block.columns, 3);
  const grid = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3";

  return (
    <Section>
      <Heading>{str(block.heading)}</Heading>
      <div className={`mt-8 grid gap-4 ${grid}`}>
        {pictures.map((p, i) => (
          <figure key={i}>
            <Picture
              media={p.media}
              className="aspect-[4/3] w-full rounded-[var(--site-radius)] object-cover"
            />
            {p.caption && (
              <figcaption className="mt-2 text-sm text-[var(--site-ink-500)]">{p.caption}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </Section>
  );
}

function FaqBlock({ block }: { block: Block }) {
  const items = ((block.items as { q: string; a: string }[]) ?? []).filter((i) => i.q);
  if (items.length === 0) return null;

  return (
    <Section tone="tint">
      <Heading>{str(block.heading) || "Questions"}</Heading>
      <div className="mt-8 divide-y divide-[var(--site-ink-200)]">
        {items.map((item, i) => (
          // <details> rather than a JavaScript accordion: it works before
          // hydration, it works with JavaScript off, and Ctrl-F finds the text
          // inside it in every current browser.
          <details key={i} className="group py-4" open={i === 0}>
            <summary className="cursor-pointer list-none font-medium text-[var(--site-ink-900)] marker:content-none">
              <span className="inline-flex w-full items-center justify-between gap-4">
                {item.q}
                <span className="text-[var(--site-ink-400)] transition group-open:rotate-45">+</span>
              </span>
            </summary>
            <Prose text={item.a} className="mt-3" />
          </details>
        ))}
      </div>
    </Section>
  );
}

function TimelineBlock({ block }: { block: Block }) {
  const items = ((block.items as { when: string; title: string; body: string }[]) ?? []).filter(
    (i) => i.when || i.title,
  );
  if (items.length === 0) return null;

  return (
    <Section>
      <Heading>{str(block.heading) || "Our history"}</Heading>
      <ol className="mt-8 border-l border-[var(--site-ink-200)] pl-6">
        {items.map((item, i) => (
          <li key={i} className="relative pb-8 last:pb-0">
            <span className="absolute -left-[1.65rem] top-2 size-2.5 rounded-full bg-[var(--site-brand-solid)]" />
            <p className="font-[family-name:var(--site-font-display)] text-sm font-semibold tracking-wide text-[var(--site-brand-700)]">
              {item.when}
            </p>
            <h3 className="mt-1 font-medium text-[var(--site-ink-900)]">{item.title}</h3>
            {item.body && <p className="mt-1 text-[var(--site-ink-600)]">{item.body}</p>}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function QuoteBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  if (!str(block.body)) return null;
  const media = ctx.media.get(str(block.mediaId));
  return (
    <Section>
      <figure className="mx-auto max-w-3xl text-center">
        <Quote className="mx-auto size-8 text-[var(--site-accent-500)]" strokeWidth={1.5} aria-hidden />
        <blockquote className="mt-4 font-[family-name:var(--site-font-display)] text-[clamp(1.25rem,3vw,1.75rem)] leading-snug text-balance text-[var(--site-ink-900)]">
          {str(block.body)}
        </blockquote>
        <figcaption className="mt-6 flex items-center justify-center gap-3">
          {media && <Picture media={media} className="size-11 rounded-full object-cover" />}
          <span className="text-left">
            <span className="block font-medium text-[var(--site-ink-800)]">{str(block.attribution)}</span>
            {str(block.role) && (
              <span className="block text-sm text-[var(--site-ink-500)]">{str(block.role)}</span>
            )}
          </span>
        </figcaption>
      </figure>
    </Section>
  );
}

function LogosBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const items = ((block.items as { mediaId: string; name: string; href: string }[]) ?? []).filter(
    (i) => i.name || i.mediaId,
  );
  if (items.length === 0) return null;

  return (
    <Section tone="tint">
      {str(block.heading) && (
        <p className="text-center text-sm font-medium tracking-wide text-[var(--site-ink-500)] uppercase">
          {str(block.heading)}
        </p>
      )}
      <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {items.map((item, i) => {
          const media = ctx.media.get(item.mediaId);
          const inner = media ? (
            <Picture media={media} className="h-9 w-auto object-contain" />
          ) : (
            <span className="text-[var(--site-ink-600)]">{item.name}</span>
          );
          const to = safeHref(item.href);
          return (
            <li key={i}>
              {to ? (
                <a href={to} rel="noopener" className="opacity-80 transition hover:opacity-100">
                  {inner}
                </a>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function ContactBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const rows: { icon: string; label: string; value: string; href?: string }[] = [];
  if (str(block.meetsText)) rows.push({ icon: "clock", label: "We meet", value: str(block.meetsText) });
  if (str(block.addressText)) {
    rows.push({
      icon: "map-pin",
      label: "Where",
      value: str(block.addressText),
      href: safeHref(block.mapHref) || undefined,
    });
  }
  if (str(block.email)) {
    rows.push({ icon: "mail", label: "Email", value: str(block.email), href: `mailto:${str(block.email)}` });
  }
  if (str(block.phone)) {
    rows.push({ icon: "phone", label: "Phone", value: str(block.phone), href: `tel:${str(block.phone).replace(/[^\d+]/g, "")}` });
  }
  if (rows.length === 0) return null;

  return (
    <Section>
      <Heading>{str(block.heading) || "Where and when"}</Heading>
      <dl className="mt-8 grid gap-6 sm:grid-cols-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-3">
            <BlockIcon name={row.icon} className="mt-1 size-5 shrink-0 text-[var(--site-brand-700)]" />
            <div>
              <dt className="text-sm text-[var(--site-ink-500)]">{row.label}</dt>
              <dd className="whitespace-pre-line text-[var(--site-ink-800)]">
                {row.href ? (
                  <a href={row.href} className="underline decoration-[var(--site-ink-300)] underline-offset-4">
                    {row.value}
                  </a>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          </div>
        ))}
      </dl>
      {ctx.club.city && rows.every((r) => r.label !== "Where") && (
        <p className="mt-6 text-[var(--site-ink-600)]">
          {ctx.club.city}
          {ctx.club.state ? `, ${ctx.club.state}` : ""}
        </p>
      )}
    </Section>
  );
}

function CtaBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  if (!str(block.heading) && !str(block.ctaLabel)) return null;
  const tone = str(block.tone) || "brand";
  return (
    <Section tone={tone === "quiet" ? "tint" : tone === "gold" ? "accent" : "brand"}>
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-[family-name:var(--site-font-display)] text-[clamp(1.5rem,4vw,2.25rem)] leading-tight font-semibold text-balance">
          {str(block.heading)}
        </h2>
        {str(block.body) && <p className="mt-4 text-[1.05rem] leading-relaxed opacity-90">{str(block.body)}</p>}
        <div className="mt-8 flex justify-center">
          <Cta
            label={block.ctaLabel}
            to={block.ctaHref}
            base={ctx.base}
            // Inside a brand band, a brand-coloured button is invisible.
            tone={tone === "quiet" ? "brand" : "quiet"}
          />
        </div>
      </div>
    </Section>
  );
}

function VideoBlock({ block }: { block: Block }) {
  const src = videoEmbedSrc(str(block.provider), str(block.videoId));
  if (!src) return null;
  return (
    <Section>
      <Heading>{str(block.heading)}</Heading>
      <div className="mt-6 overflow-hidden rounded-[calc(var(--site-radius)*1.4)]">
        <iframe
          src={src}
          title={str(block.heading) || "Video"}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full border-0"
        />
      </div>
      {str(block.caption) && (
        <p className="mt-3 text-sm text-[var(--site-ink-500)]">{str(block.caption)}</p>
      )}
    </Section>
  );
}

function DividerBlock({ block }: { block: Block }) {
  const style = str(block.style) || "rule";
  if (style === "space") return <div className="h-[calc(3rem*var(--site-space))]" />;
  if (style === "wheel") {
    return (
      <div className="flex justify-center py-[calc(2rem*var(--site-space))]">
        <CircleDot className="size-6 text-[var(--site-accent-500)]" strokeWidth={1.5} aria-hidden />
      </div>
    );
  }
  return (
    <div className="px-6">
      <hr className="mx-auto max-w-5xl border-[var(--site-ink-200)]" />
    </div>
  );
}

/** The join form. Same field names, honeypot and timing trap as the old page. */
function JoinBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  const state = ctx.formState;
  const input =
    "w-full rounded-[var(--site-radius)] border border-[var(--site-ink-300)] bg-white px-3.5 py-2.5 text-[var(--site-ink-900)] placeholder:text-[var(--site-ink-400)]";

  return (
    <Section tone="tint" id="get-in-touch">
      <div className="mx-auto max-w-xl">
        <Heading>{str(block.heading) || "Get in touch"}</Heading>
        <Prose text={block.body} className="mt-3" />

        {state?.ok ? (
          <p className="mt-6 rounded-[var(--site-radius)] border border-[var(--site-brand-200)] bg-[var(--site-brand-50)] px-5 py-4 text-[var(--site-ink-800)]">
            {str(block.thanksText) || state.message}
          </p>
        ) : (
          <Form method="post" className="mt-6 space-y-4">
            {/* Honeypot. Off-screen rather than display:none — some bots skip
                hidden fields, and a real person never reaches it by tabbing. */}
            <div className="absolute -left-[9999px]" aria-hidden>
              <label htmlFor="website">Website</label>
              <input id="website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            <input type="hidden" name="elapsed" defaultValue="0" ref={stampElapsed} />

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-[var(--site-ink-700)]">Your name</span>
                <input name="name" required autoComplete="name" className={input} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-[var(--site-ink-700)]">Email</span>
                <input name="email" type="email" required autoComplete="email" className={input} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-[var(--site-ink-700)]">
                Phone <span className="font-normal text-[var(--site-ink-500)]">— optional</span>
              </span>
              <input name="phone" type="tel" autoComplete="tel" className={input} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-[var(--site-ink-700)]">
                Anything you'd like us to know
              </span>
              <textarea name="message" rows={4} className={input} />
            </label>

            {state && !state.ok && (
              <p className="text-sm text-[var(--site-ink-800)]">{state.message}</p>
            )}

            <button
              type="submit"
              disabled={ctx.submitting}
              className="inline-flex items-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-brand-solid)] px-5 py-2.5 font-medium text-[var(--site-on-brand)] transition hover:opacity-90 disabled:opacity-60"
            >
              {ctx.submitting ? "Sending…" : str(block.buttonLabel) || "Send"}
            </button>
          </Form>
        )}
      </div>
    </Section>
  );
}

function DonateBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  // Hidden entirely unless the club's own Stripe account can take money. A
  // Donate button that 400s is worse than no Donate button.
  if (!ctx.donations) return null;
  const amounts = ctx.donations.amounts.length ? ctx.donations.amounts : [2500, 5000, 10000];

  return (
    <Section id="donate">
      <div className="mx-auto max-w-xl">
        <Heading>{str(block.heading) || "Support our work"}</Heading>
        <Prose text={str(block.body) || ctx.donations.blurb} className="mt-3" />

        <Form method="post" className="mt-6 space-y-5">
          <input type="hidden" name="intent" value="donate" />
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-[var(--site-ink-700)]">Amount</legend>
            <div className="flex flex-wrap gap-2">
              {amounts.map((cents, i) => (
                <label key={cents} className="cursor-pointer">
                  <input
                    type="radio"
                    name="amount"
                    value={String(cents)}
                    defaultChecked={i === 0}
                    className="peer sr-only"
                  />
                  <span className="inline-block rounded-[var(--site-radius)] border border-[var(--site-ink-300)] px-4 py-2 peer-checked:border-[var(--site-brand-solid)] peer-checked:bg-[var(--site-brand-50)]">
                    {money(cents)}
                  </span>
                </label>
              ))}
              <label className="cursor-pointer">
                <input type="radio" name="amount" value="other" className="peer sr-only" />
                <span className="inline-block rounded-[var(--site-radius)] border border-[var(--site-ink-300)] px-4 py-2 peer-checked:border-[var(--site-brand-solid)] peer-checked:bg-[var(--site-brand-50)]">
                  Another amount
                </span>
              </label>
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-1.5 block text-sm text-[var(--site-ink-600)]">
              If you chose another amount
            </span>
            <input
              name="customAmount"
              inputMode="decimal"
              placeholder="50.00"
              className="w-40 rounded-[var(--site-radius)] border border-[var(--site-ink-300)] bg-white px-3.5 py-2.5"
            />
          </label>

          <label className="flex items-start gap-2.5 text-[var(--site-ink-700)]">
            <input
              type="checkbox"
              name="coverFee"
              defaultChecked={ctx.donations.coverFeeDefault}
              className="mt-1"
            />
            <span>
              Add the card processing fee so the club receives the full amount.
              <span className="block text-sm text-[var(--site-ink-500)]">
                About 3%. Entirely up to you — the gift is just as welcome either way.
              </span>
            </span>
          </label>

          {ctx.formState && !ctx.formState.ok && (
            <p className="text-sm text-[var(--site-ink-800)]">{ctx.formState.message}</p>
          )}

          <button
            type="submit"
            disabled={ctx.submitting}
            className="inline-flex items-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-accent-solid)] px-5 py-2.5 font-medium text-[var(--site-on-accent)] transition hover:opacity-90 disabled:opacity-60"
          >
            <Heart className="size-4" strokeWidth={2} aria-hidden />
            {ctx.submitting ? "One moment…" : "Give"}
          </button>
          <p className="text-sm text-[var(--site-ink-500)]">
            Payment is handled by Stripe and goes directly to {ctx.club.name}. Sodalitas never holds
            the money and takes no cut.
          </p>
        </Form>
      </div>
    </Section>
  );
}

function RichTextBlock({ block }: { block: Block }) {
  if (!str(block.heading) && !str(block.body)) return null;
  const centred = str(block.align) === "centre";
  return (
    <Section>
      <div className={centred ? "mx-auto max-w-2xl text-center" : "max-w-3xl"}>
        <Heading>{str(block.heading)}</Heading>
        <Prose text={block.body} className={str(block.heading) ? "mt-5" : ""} />
      </div>
    </Section>
  );
}

// ── The switch ────────────────────────────────────────────────────────────────

export function RenderBlock({ block, ctx }: { block: Block; ctx: RenderContext }) {
  switch (block.type) {
    case "hero": return <HeroBlock block={block} ctx={ctx} />;
    case "richText": return <RichTextBlock block={block} />;
    case "stats": return <StatsBlock block={block} />;
    case "cards": return <CardsBlock block={block} ctx={ctx} />;
    case "meetings": return <MeetingsBlock block={block} ctx={ctx} />;
    case "events": return <EventsBlock block={block} ctx={ctx} />;
    case "documents": return <DocumentsBlock block={block} ctx={ctx} />;
    case "projects": return <ProjectsBlock block={block} ctx={ctx} />;
    case "officers": return <OfficersBlock block={block} ctx={ctx} />;
    case "join": return <JoinBlock block={block} ctx={ctx} />;
    case "donate": return <DonateBlock block={block} ctx={ctx} />;
    case "gallery": return <GalleryBlock block={block} ctx={ctx} />;
    case "faq": return <FaqBlock block={block} />;
    case "timeline": return <TimelineBlock block={block} />;
    case "quote": return <QuoteBlock block={block} ctx={ctx} />;
    case "logos": return <LogosBlock block={block} ctx={ctx} />;
    case "contact": return <ContactBlock block={block} ctx={ctx} />;
    case "cta": return <CtaBlock block={block} ctx={ctx} />;
    case "video": return <VideoBlock block={block} />;
    case "divider": return <DividerBlock block={block} />;
    // No default that renders something. An unrecognised type has already been
    // dropped by validateBlocks; if one reaches here the honest answer is
    // nothing rather than a guess.
    default: return null;
  }
}

export function RenderBlocks({ blocks, ctx }: { blocks: Block[]; ctx: RenderContext }) {
  return (
    <>
      {blocks.map((block) => (
        <RenderBlock key={block.id} block={block} ctx={ctx} />
      ))}
    </>
  );
}

// ── The shell ─────────────────────────────────────────────────────────────────

const THEME_SHELL: Record<ThemeKey, { header: string; brandbar: boolean }> = {
  classic: { header: "border-b border-[var(--site-ink-200)]", brandbar: false },
  civic: { header: "bg-[var(--site-brand-solid)] text-[var(--site-on-brand)]", brandbar: true },
  editorial: { header: "", brandbar: false },
  compact: { header: "border-b border-[var(--site-ink-200)]", brandbar: false },
};

/**
 * Header, footer, and the tokens everything inside reads.
 *
 * The header nav is a `<details>` below the small breakpoint for the same
 * reason the app's is: it works before hydration and it cannot get stuck open
 * after a failed navigation. Club sites are read on phones in car parks.
 */
export function SiteShell({
  club,
  tokens,
  theme,
  nav,
  base,
  children,
  footerNote,
}: {
  club: { name: string; city: string | null; state: string | null };
  tokens: BrandTokens;
  theme: ThemeKey;
  nav: { href: string; label: string }[];
  base: string;
  children: ReactNode;
  footerNote?: ReactNode;
}) {
  const shell = THEME_SHELL[theme];
  const style = tokensToStyle(tokens) as React.CSSProperties;
  const homeHref = base || "/";

  return (
    <div
      style={style}
      className="min-h-svh bg-white font-[family-name:var(--site-font-text)] text-[var(--site-ink-800)] antialiased"
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--site-radius)] focus:bg-[var(--site-brand-solid)] focus:px-4 focus:py-2 focus:text-[var(--site-on-brand)]"
      >
        Skip to content
      </a>

      <header className={shell.header}>
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <Link
            to={homeHref}
            className="font-[family-name:var(--site-font-display)] text-lg leading-tight font-semibold tracking-tight"
          >
            {club.name}
          </Link>

          {nav.length > 0 && (
            <>
              <nav className="hidden gap-6 sm:flex">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    to={item.href.startsWith("/") ? `${base}${item.href === "/" ? "" : item.href}` || "/" : item.href}
                    prefetch="intent"
                    className={`text-[0.95rem] transition ${
                      shell.brandbar ? "opacity-90 hover:opacity-100" : "text-[var(--site-ink-600)] hover:text-[var(--site-ink-900)]"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>

              <details className="relative sm:hidden">
                <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-[var(--site-radius)] marker:content-none">
                  <span className="sr-only">Menu</span>
                  <span aria-hidden className="text-xl leading-none">☰</span>
                </summary>
                <nav className="absolute right-0 z-40 mt-2 flex w-56 flex-col rounded-[var(--site-radius)] border border-[var(--site-ink-200)] bg-white p-2 shadow-lg">
                  {nav.map((item) => (
                    <Link
                      key={item.href}
                      to={item.href.startsWith("/") ? `${base}${item.href === "/" ? "" : item.href}` || "/" : item.href}
                      className="rounded-[var(--site-radius)] px-3 py-2.5 text-[var(--site-ink-700)] hover:bg-[var(--site-ink-50)]"
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </details>
            </>
          )}
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="border-t border-[var(--site-ink-200)] px-6 py-10 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-end justify-between gap-6 text-sm text-[var(--site-ink-500)]">
          <div>
            <p className="font-medium text-[var(--site-ink-700)]">{club.name}</p>
            {club.city && (
              <p>
                {club.city}
                {club.state ? `, ${club.state}` : ""}
              </p>
            )}
            {footerNote}
          </div>
          <p>
            {/* Small, honest, and linked. A club's site is the club's — the
                credit is a line in the footer, not a badge on the header. */}
            Built with{" "}
            <a
              href="https://sodalitas.jer-f84.workers.dev"
              className="underline decoration-[var(--site-ink-300)] underline-offset-4 hover:text-[var(--site-ink-700)]"
            >
              Sodalitas
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Stamps how long the form was on screen, for the timing trap. */
export function stampElapsed(el: HTMLInputElement | null) {
  if (!el) return;
  const start = Date.now();
  const form = el.form;
  if (!form) return;
  form.addEventListener(
    "submit",
    () => {
      el.value = String(Date.now() - start);
    },
    { once: true },
  );
}
