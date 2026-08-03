/**
 * seo.ts — meta tags and structured data for every public page.
 *
 * SEO is a product surface here, not an afterthought. Clubs find software by
 * searching for their problem ("rotary club attendance tracking", "clubrunner
 * alternative"), and increasingly by asking an assistant — which means the
 * pages have to be legible to both.
 *
 * One helper builds the whole head so no page can quietly ship without a
 * canonical or an og:image.
 *
 * React Router gotcha: `meta()` receives `loaderData`, not `data`.
 */

import { brand } from "@content/brand";

const SITE = `https://${brand.domain}`;
const DEFAULT_IMAGE = `${SITE}/og.png`;

export interface MetaInput {
  title: string;
  description: string;
  /** Absolute path, e.g. "/pricing". Becomes the canonical. */
  path: string;
  image?: string;
  type?: "website" | "article";
  noIndex?: boolean;
}

type MetaDescriptor = Record<string, unknown>;

/** Build the full head for a public page. */
export function marketingMeta(input: MetaInput): MetaDescriptor[] {
  const title = input.title.includes(brand.name) ? input.title : `${input.title} — ${brand.name}`;
  const url = `${SITE}${input.path === "/" ? "" : input.path}`;
  const image = input.image ?? DEFAULT_IMAGE;

  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: input.description },
    { tagName: "link", rel: "canonical", href: url },

    { property: "og:type", content: input.type ?? "website" },
    { property: "og:site_name", content: brand.name },
    { property: "og:title", content: title },
    { property: "og:description", content: input.description },
    { property: "og:url", content: url },
    { property: "og:image", content: image },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: image },
  ];

  if (input.noIndex) tags.push({ name: "robots", content: "noindex, nofollow" });
  return tags;
}

/** Head for signed-in pages. Never indexed — a club's roster is not public. */
export function appMeta(title: string): MetaDescriptor[] {
  return [
    { title: `${title} — ${brand.name}` },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

// ── Structured data ───────────────────────────────────────────────────────────

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: brand.name,
    url: SITE,
    description: brand.positioning,
  };
}

export function softwareSchema(opts: { lowPriceCents: number; highPriceCents: number }) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: brand.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: brand.positioning,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: (opts.lowPriceCents / 100).toFixed(2),
      highPrice: (opts.highPriceCents / 100).toFixed(2),
    },
  };
}

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: `${SITE}${t.path}`,
    })),
  };
}

/** Serialise JSON-LD for a <script> tag, escaping the one sequence that can break out. */
export function jsonLd(schema: object): string {
  return JSON.stringify(schema).replace(/</g, "\\u003c");
}
