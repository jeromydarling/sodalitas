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
