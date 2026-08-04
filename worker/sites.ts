/**
 * sites.ts — routing a request that didn't arrive on our hostname.
 *
 * Two ways a visitor reaches a club's site without going through
 * sodalitas.app: they typed the club's own domain, or somebody sent them a
 * preview link for a draft. Both end up in the same place — the request is
 * rewritten to `/club/<slug>/...` and handed to the ordinary router, so there
 * is one implementation of a club page rather than three.
 *
 * The rewrite is also the isolation boundary. On a club's own domain
 * *everything* is rewritten under their club path, which means `/login`,
 * `/app/people` and `/api/health` on rotaryclubofsomewhere.org resolve to
 * pages that don't exist. A club's domain cannot serve the application, and
 * that is a property of the routing rather than a list of paths to block —
 * a new app route can't accidentally become reachable there next month.
 */

import { resolveSiteByHostname, resolveSitePreviewToken, type PublicSiteRef } from "@db/publicLookup";
import { hashToken } from "./auth/crypto";
import type { Env } from "./context";
import type { SiteRequest } from "./loadContext";

/**
 * Hostnames that are ours.
 *
 * `workers.dev` covers the deployment URL and every preview deployment;
 * localhost covers development. Anything else is either a club's domain or a
 * probe, and both get the same lookup.
 */
export function isPlatformHost(hostname: string, env: Env): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".workers.dev") || host === "workers.dev") return true;
  if (host === "sodalitas.app" || host.endsWith(".sodalitas.app")) return true;
  try {
    if (host === new URL(env.APP_URL).hostname.toLowerCase()) return true;
  } catch {
    /* a malformed APP_URL shouldn't make every request a club lookup */
  }
  return false;
}

export interface SiteRouting {
  /** The request to hand the router, already rewritten. */
  request: Request;
  context: SiteRequest;
}

/**
 * Work out what a request on a foreign hostname is asking for.
 *
 * Returns null when the hostname resolves to nothing — the caller decides what
 * that means. (It means a redirect to the marketing site: someone has pointed
 * a domain at us and not finished, and a blank 404 tells them nothing.)
 */
export async function routeCustomHostname(
  request: Request,
  env: Env,
  url: URL,
): Promise<SiteRouting | null> {
  const site = await resolveSiteByHostname(env.DB, url.hostname);
  if (!site) return null;
  return {
    request: rewrite(request, url, site.club_slug, url.pathname),
    context: { hostname: url.hostname.toLowerCase(), preview: false, siteId: site.site_id },
  };
}

/**
 * `/preview/<token>/<path>` on our own hostname.
 *
 * The token is hashed before lookup, like every other token here. A valid one
 * makes draft pages visible for this request only — the flag travels in a
 * router context, never a header, so it cannot be asserted by whoever is
 * asking.
 */
export async function routePreview(
  request: Request,
  env: Env,
  url: URL,
): Promise<SiteRouting | "not-found" | null> {
  const match = /^\/preview\/([A-Za-z0-9_-]{16,64})(\/.*)?$/.exec(url.pathname);
  if (!match) return null;

  const site = await resolveSitePreviewToken(env.DB, await hashToken(match[1]!));
  if (!site) return "not-found";

  return {
    request: rewrite(request, url, site.club_slug, match[2] ?? "/"),
    context: { hostname: null, preview: true, siteId: site.site_id },
  };
}

function rewrite(request: Request, url: URL, clubSlug: string, path: string): Request {
  const target = new URL(url);
  const suffix = path === "/" || path === "" ? "" : path;
  target.pathname = `/club/${clubSlug}${suffix}`;

  // `new Request(url, request)` copies method, headers and body. Redirect mode
  // is reset to "follow" by the constructor, which is right: this is a fresh
  // request into our own router, not a proxied one.
  return new Request(target, request);
}

/**
 * robots.txt for a club's own domain.
 *
 * Ours points at our sitemap and disallows the app; theirs must not. A club
 * whose robots.txt says "Disallow: /app" is publishing a hint about software
 * they use, and one whose sitemap points at sodalitas.app is handing us their
 * SEO — the whole point of a custom domain is that the club's pages rank as
 * the club's.
 */
export function clubRobots(hostname: string): Response {
  return new Response(
    [
      "User-agent: *",
      "Allow: /",
      "",
      `Sitemap: https://${hostname}/sitemap.xml`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  );
}

/** The club's own sitemap: their published pages, on their own domain. */
export async function clubSitemap(env: Env, site: PublicSiteRef, hostname: string): Promise<Response> {
  const pages = await env.DB.prepare(
    `SELECT slug, updated_at FROM site_pages
      WHERE tenant_id = ? AND site_id = ? AND status = 'published' AND noindex = 0
      ORDER BY sort_order`,
  )
    .bind(site.tenant_id, site.site_id)
    .all<{ slug: string; updated_at: string }>();

  const urls = (pages.results ?? [])
    .map((p) => {
      const loc = `https://${hostname}${p.slug ? `/${p.slug}` : "/"}`;
      return `  <url><loc>${loc}</loc><lastmod>${p.updated_at.slice(0, 10)}</lastmod></url>`;
    })
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
  );
}
