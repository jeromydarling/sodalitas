/**
 * media.tsx — render an image slot, if it has an image yet.
 *
 * No images ship with the repository. `scripts/generate-images.ts` writes them
 * into `app/media/`, and the glob below is evaluated by Vite at build time, so
 * a slot starts rendering the moment its file exists and needs no code change,
 * no config and no registry of what has been generated.
 *
 * A slot with no file renders **nothing at all**. Not a grey box, not a
 * skeleton, not a mountain glyph — an empty frame reads as a broken page,
 * whereas a section that simply closes up reads as a section without a picture.
 * Every layout using <Media> has to look finished without it, which is the only
 * way a site with no images can ship at all.
 */

import type { ReactNode } from "react";
import { mediaSlot } from "@content/media";

/**
 * Every generated image, keyed by filename.
 *
 * `eager` because these are URL strings after transformation, not modules worth
 * splitting, and because a lazy glob would make the "does it exist" question
 * asynchronous — which would put a loading state into a component whose whole
 * job is to disappear cleanly.
 */
const FILES = import.meta.glob<{ default: string }>("./media/*.{webp,png,jpg,jpeg,avif}", {
  eager: true,
});

/** Filename without extension → resolved URL. */
const BY_KEY = new Map<string, string>(
  Object.entries(FILES).map(([path, mod]) => {
    const file = path.split("/").pop() ?? "";
    return [file.replace(/\.[^.]+$/, ""), mod.default];
  }),
);

export function hasMedia(key: string): boolean {
  return BY_KEY.has(key);
}

const ASPECT: Record<string, string> = {
  "16/9": "aspect-[16/9]",
  "4/3": "aspect-[4/3]",
  "3/2": "aspect-[3/2]",
  "21/9": "aspect-[21/9]",
  "1/1": "aspect-square",
};

/**
 * An image slot.
 *
 * `priority` marks the one image above the fold on a page — it loads eagerly
 * and is decoded synchronously. Everything else is lazy, because a marketing
 * page that blocks on four photographs is slower than one with none.
 */
export function Media({
  slot,
  className = "",
  priority = false,
}: {
  slot: string;
  className?: string;
  priority?: boolean;
}) {
  const src = BY_KEY.get(slot);
  if (!src) return null;

  const meta = mediaSlot(slot);
  const alt = meta?.alt ?? "";

  return (
    <img
      src={src}
      alt={alt}
      // An empty alt is a decorative image and must be hidden from the
      // accessibility tree entirely, not announced as an unlabelled graphic.
      aria-hidden={alt === "" ? true : undefined}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      className={`w-full rounded-2xl object-cover ${ASPECT[meta?.aspect ?? "16/9"]} ${className}`}
    />
  );
}

/**
 * A photograph behind a section, faded to almost nothing.
 *
 * Three things make this work rather than look like a stock-photo hero:
 *
 *   **It is very faint.** Around 18% in light mode. The point is a wash of
 *   warmth and a sense of a room, not a picture you look at — and body text
 *   sitting on a photograph is unreadable long before it's illegible.
 *
 *   **It fades out downward.** A hard bottom edge announces "image", and the
 *   section below then has to start with a rule to recover. The mask runs the
 *   photograph into the page background so there is no edge at all.
 *
 *   **It inverts for dark mode.** A photograph that reads as a soft wash on
 *   white reads as a bright smear on near-black, so the dark variant is
 *   dimmer still and sits under a scrim rather than over one.
 *
 * `aria-hidden` unconditionally, and a `<div>` rather than an `<img>` with
 * empty alt: this is decoration and there is never anything here worth
 * announcing.
 */
export function MediaBackdrop({
  slot,
  className = "",
  /** 0–100. The default is what the homepage hero uses. */
  opacity = 18,
}: {
  slot: string;
  className?: string;
  opacity?: number;
}) {
  const src = BY_KEY.get(slot);
  if (!src) return null;

  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}>
      <div
        className="size-full bg-cover bg-center bg-no-repeat opacity-[var(--backdrop-o)] dark:opacity-[var(--backdrop-o-dark)]"
        style={
          {
            backgroundImage: `url(${src})`,
            "--backdrop-o": `${opacity}%`,
            // Dark mode gets roughly half. The same wash that is gentle on
            // white glows on ink-950.
            "--backdrop-o-dark": `${Math.round(opacity * 0.5)}%`,
            // Solid for the top two thirds, then out — so the section can end
            // wherever the layout wants without a visible edge.
            maskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 55%, transparent 100%)",
          } as React.CSSProperties
        }
      />
      {/* A scrim over the top. Even at 18% a photograph puts texture behind
          body copy; this keeps the area under the headline calm without
          flattening the whole image. */}
      <div className="absolute inset-0 bg-gradient-to-r from-white via-white/70 to-transparent dark:from-ink-950 dark:via-ink-950/70" />
    </div>
  );
}

/**
 * A photograph edge to edge across the page, breaking up the sections.
 *
 * Height is clamped rather than left to the aspect ratio: a 21:9 image at full
 * viewport width is 550px tall on a laptop, which is a wall to scroll past
 * between two sections that were meant to feel adjacent. `object-cover` inside
 * a clamped box crops instead, which is what a magazine does.
 *
 * Renders nothing without a file, and the sections either side keep their own
 * borders, so the page reads as finished either way.
 */
export function MediaBand({ slot, className = "" }: { slot: string; className?: string }) {
  const src = BY_KEY.get(slot);
  if (!src) return null;

  const alt = mediaSlot(slot)?.alt ?? "";

  return (
    <div className={`border-y border-ink-200 dark:border-ink-800 ${className}`}>
      <img
        src={src}
        alt={alt}
        aria-hidden={alt === "" ? true : undefined}
        loading="lazy"
        decoding="async"
        className="h-[clamp(160px,26vw,340px)] w-full object-cover"
      />
    </div>
  );
}

/**
 * Wrap content that should only appear alongside a picture.
 *
 * For the cases where a layout genuinely needs the image to make sense — a
 * two-column split collapses to one column rather than leaving a hole.
 */
export function WithMedia({
  slot,
  children,
  fallback = null,
}: {
  slot: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return hasMedia(slot) ? <>{children}</> : <>{fallback}</>;
}
