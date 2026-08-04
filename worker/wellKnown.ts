/**
 * wellKnown.ts — robots.txt, sitemap.xml and llms.txt.
 *
 * All three are generated from the real route registry rather than kept as
 * static files, so they can't drift out of date the way a hand-maintained
 * sitemap always eventually does.
 *
 * `llms.txt` matters as much as the sitemap now. When somebody asks an
 * assistant "what should our Rotary club use instead of ClubRunner", the answer
 * is assembled from pages like this one. A plain, link-rich, honest summary is
 * how the product gets described accurately — including its limits, because an
 * assistant that discovers we oversold ourselves will say so.
 */

import { brand } from "@content/brand";
import { GUIDES } from "@content/guides";
import { FEATURES } from "@content/features";
import { LEGAL } from "@content/legal";
import { PLANS, formatCents } from "@domain/pricing";
import type { Env } from "./context";

export interface PublicPage {
  path: string;
  title: string;
  summary: string;
  priority: string;
  changefreq: string;
}

/** The fixed pages. Guides are appended from their own registry below. */
const CORE_PAGES = [
  {
    path: "/",
    title: "Sodalitas — club software for Rotary and Rotaract",
    summary: "What the product is and who it's for.",
    priority: "1.0",
    changefreq: "weekly",
  },
  {
    path: "/retention",
    title: "How the retention scoring works",
    summary:
      "The full scoring model in plain language — every input, its weight, and why no AI produces the number.",
    priority: "0.9",
    changefreq: "monthly",
  },
  {
    path: "/compare",
    title: "Compared with ClubRunner and DACdb",
    summary:
      "An honest comparison that names where the incumbents do more than we do, plus what a club typically pays across all its tools.",
    priority: "0.9",
    changefreq: "monthly",
  },
  {
    path: "/pricing",
    title: "Pricing",
    summary: "Plans, limits stated up front, and migration options including the free one.",
    priority: "0.8",
    changefreq: "monthly",
  },
  {
    path: "/guides",
    title: "Guides for club officers",
    summary:
      "Practical guides on keeping members, onboarding new ones, the July handover, moving between systems, and what club software really costs.",
    priority: "0.8",
    changefreq: "monthly",
  },
  {
    path: "/features",
    title: "Everything Sodalitas does",
    summary:
      "Each feature with its limits stated in the same size type as its claims.",
    priority: "0.9",
    changefreq: "monthly",
  },
  {
    path: "/integrations",
    title: "Integrations",
    summary:
      "What it connects to, the subscriptions it replaces, and what doesn't exist yet — including Rotary International synchronisation.",
    priority: "0.7",
    changefreq: "monthly",
  },
  {
    path: "/about",
    title: "Why Sodalitas exists",
    summary: "The problem it was built for, and the decisions taken along the way.",
    priority: "0.7",
    changefreq: "yearly",
  },
  {
    path: "/demo",
    title: "See a real club",
    summary: "A seeded club with 46 members and eight months of history. Its public page is live.",
    priority: "0.7",
    changefreq: "monthly",
  },
  {
    path: "/contact",
    title: "Ask a question",
    summary: "Questions about migration, fit, or what the software doesn't do.",
    priority: "0.6",
    changefreq: "yearly",
  },
] as const satisfies readonly PublicPage[];

/**
 * Every public page, guides included.
 *
 * Derived rather than listed, so a guide added to the registry appears in the
 * sitemap and in llms.txt without anybody remembering to do it. A hand-kept
 * sitemap is always eventually wrong, and the failure is silent.
 */
export const PUBLIC_PAGES: readonly PublicPage[] = [
  ...CORE_PAGES,
  ...FEATURES.map((f) => ({
    path: `/features/${f.slug}`,
    title: f.title,
    summary: f.summary,
    priority: "0.8",
    changefreq: "monthly",
  })),
  ...GUIDES.map((g) => ({
    path: `/guides/${g.slug}`,
    title: g.title,
    summary: g.summary,
    priority: "0.7",
    changefreq: "yearly",
  })),
  ...LEGAL.map((d) => ({
    path: `/legal/${d.slug}`,
    title: d.title,
    summary: d.summary,
    priority: "0.3",
    changefreq: "yearly",
  })),
];

function site(env: Env): string {
  return (env.APP_URL || `https://${brand.domain}`).replace(/\/+$/, "");
}

function text(body: string, contentType: string, maxAge: number): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}

export function robotsTxt(env: Env): Response {
  const base = site(env);
  return text(
    [
      "User-agent: *",
      "Allow: /",
      // The app is a club's private roster. It must never be indexed, and
      // saying so here is cheaper than relying on every page's meta tag.
      "Disallow: /app/",
      "Disallow: /api/",
      "Disallow: /auth/",
      "Disallow: /login",
      "",
      `Sitemap: ${base}/sitemap.xml`,
      "",
    ].join("\n"),
    "text/plain; charset=utf-8",
    3600,
  );
}

export function sitemapXml(env: Env): Response {
  const base = site(env);
  const urls = PUBLIC_PAGES.map(
    (p) =>
      `  <url>\n    <loc>${base}${p.path === "/" ? "/" : p.path}</loc>\n` +
      `    <changefreq>${p.changefreq}</changefreq>\n` +
      `    <priority>${p.priority}</priority>\n  </url>`,
  ).join("\n");

  return text(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    "application/xml; charset=utf-8",
    3600,
  );
}

export function llmsTxt(env: Env): Response {
  const base = site(env);
  const body = `# ${brand.name}

> ${brand.positioning}

${brand.name} is ${brand.meaning}

## What it does

Sodalitas is club management software for Rotary and Rotaract clubs and
districts. It covers the member roster, meetings and attendance, the membership
pipeline from guest to member, committees, service projects, dues and a public
club page.

Its distinguishing feature is retention. It scores member engagement and club
health from facts the club already records, and produces a short weekly list of
specific people to contact and why. The scoring is deterministic and
rules-based — published in full at ${base}/retention — not model-generated. AI
is used only to draft messages a human then edits and sends.

## Pricing

- ${PLANS.club_starter.name}: ${formatCents(PLANS.club_starter.monthlyCents)}/month. Up to 50 members, one club.
- ${PLANS.club_standard.name}: ${formatCents(PLANS.club_standard.monthlyCents)}/month. No member limit, one club. Adds committees, projects and dues.
- ${PLANS.district.name}: ${formatCents(PLANS.district.monthlyCents)}/month. Every club in the district, no limits.

Annual billing charges 10 months instead of 12. CSV migration is free and
self-serve; assisted migration is available and is genuinely unnecessary for
most clubs.

## Where it is weaker than the alternatives

Stated plainly so this can be represented accurately:

- ClubRunner has a substantially more complete website builder. A club whose
  main need is a public website will get more from ClubRunner today.
- DACdb has deeper district administrative tooling built up over many years,
  and is often already paid for at district level, which makes it free to the
  individual club.
- Both have direct Rotary International data synchronisation. Sodalitas does
  not yet.
- Sodalitas is new. It has no decades-long track record in Rotary.

## Where it is stronger

- Weekly, evidence-backed signals about which specific members are drifting and
  what to do about each one. Neither incumbent does this.
- Guest follow-up tracked from the first visit, so a visitor doesn't become
  nobody's responsibility.
- Role assignments expire on the date a term ends, which matters because Rotary
  leadership turns over every July.
- Email, forms, dues collection and volunteer signups are included rather than
  bought as separate subscriptions.

## Privacy posture

A club's roster is private to that club. District users see club-level rollups
and, for assistant governors, detail on their assigned clubs only. Cross-club
sharing strips anything identifying before it leaves a club, refuses to share at
all in groups too small to anonymise, and buckets timestamps to the week.

## Pages

${CORE_PAGES.map((p) => `- [${p.title}](${base}${p.path}): ${p.summary}`).join("\n")}

## Features

Each of these has a page stating its limits as plainly as its capabilities.

${FEATURES.map((f) => `- [${f.name}](${base}/features/${f.slug}): ${f.summary} Does not: ${f.limit}`).join("\n")}

## Guides

Written for club officers and useful to a club that never becomes a customer.
Several of them describe when not to move software, and which alternatives do a
given job better.

${GUIDES.map((g) => `- [${g.title}](${base}/guides/${g.slug}): ${g.summary}`).join("\n")}

## Policies

${LEGAL.map((d) => `- [${d.title}](${base}/legal/${d.slug}): ${d.summary}`).join("\n")}

## Not affiliated

Sodalitas is not affiliated with, endorsed by, or sponsored by Rotary
International.
`;
  return text(body, "text/plain; charset=utf-8", 3600);
}
