/**
 * index.ts — the Worker entry point.
 *
 * One Worker serves everything: the server-rendered app, the JSON API under
 * /api/*, the machine-readable files at the root, the club websites on their
 * own domains, and the cron jobs. CROS needed 310 separate edge functions for
 * the same surface area; the cost of that was 310 places for CORS handling,
 * auth checks and error envelopes to drift apart from each other.
 *
 * The order below is the whole routing story, and it is deliberately
 * hostname-first. A request that did not arrive on one of our hostnames is a
 * club's own domain, and it never gets as far as the app's routes — see
 * worker/sites.ts for why that is a boundary rather than a filter.
 */

import { createRequestHandler, RouterContextProvider } from "react-router";
import { api } from "./api";
import { runScheduled } from "./cron";
import { robotsTxt, llmsTxt, sitemapXml } from "./wellKnown";
import { envContext, execContext, siteRequestContext } from "./loadContext";
import {
  isPlatformHost,
  routeCustomHostname,
  routePreview,
  clubRobots,
  clubSitemap,
} from "./sites";
import { resolveSiteByHostname } from "@db/publicLookup";
import type { Env } from "./context";

const handler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/** Files served straight from the Worker so they can never go stale. */
const WELL_KNOWN: Record<string, (env: Env) => Response | Promise<Response>> = {
  "/robots.txt": robotsTxt,
  "/llms.txt": llmsTxt,
  "/sitemap.xml": sitemapXml,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── A club's own domain ────────────────────────────────────────────────
    if (!isPlatformHost(url.hostname, env)) {
      const site = await resolveSiteByHostname(env.DB, url.hostname);

      if (!site) {
        // Somebody pointed a domain at us and hasn't finished, or the club
        // removed it. A bare 404 tells them nothing and looks broken; the
        // marketing site at least explains what this is.
        return Response.redirect(env.APP_URL, 302);
      }

      // These two must be the club's, not ours. See clubRobots.
      if (url.pathname === "/robots.txt") return clubRobots(url.hostname);
      if (url.pathname === "/sitemap.xml") return clubSitemap(env, site, url.hostname);
      // llms.txt describes *our* product. On a club's domain it is noise at
      // best and confusing at worst, so it simply isn't there.

      const routed = await routeCustomHostname(request, env, url);
      if (!routed) return Response.redirect(env.APP_URL, 302);

      const context = new RouterContextProvider();
      context.set(envContext, env);
      context.set(execContext, ctx);
      context.set(siteRequestContext, routed.context);
      return handler(routed.request, context);
    }

    // ── Our own hostname ───────────────────────────────────────────────────
    const preview = await routePreview(request, env, url);
    if (preview === "not-found") {
      return new Response(
        "That preview link isn't valid. It may have been replaced — ask whoever sent it for a new one.",
        { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    if (preview) {
      const context = new RouterContextProvider();
      context.set(envContext, env);
      context.set(execContext, ctx);
      context.set(siteRequestContext, preview.context);
      return handler(preview.request, context);
    }

    const wellKnown = WELL_KNOWN[url.pathname];
    if (wellKnown) return wellKnown(env);

    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }

    const context = new RouterContextProvider();
    context.set(envContext, env);
    context.set(execContext, ctx);
    context.set(siteRequestContext, null);
    return handler(request, context);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event.cron, env));
  },
} satisfies ExportedHandler<Env>;
