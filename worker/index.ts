/**
 * index.ts — the Worker entry point.
 *
 * One Worker serves everything: the server-rendered app, the JSON API under
 * /api/*, the machine-readable files at the root, and the cron jobs. CROS
 * needed 310 separate edge functions for the same surface area; the cost of
 * that was 310 places for CORS handling, auth checks and error envelopes to
 * drift apart from each other.
 */

import { createRequestHandler, RouterContextProvider } from "react-router";
import { api } from "./api";
import { runScheduled } from "./cron";
import { robotsTxt, llmsTxt, sitemapXml } from "./wellKnown";
import { envContext, execContext } from "./loadContext";
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

    const wellKnown = WELL_KNOWN[url.pathname];
    if (wellKnown) return wellKnown(env);

    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }

    const context = new RouterContextProvider();
    context.set(envContext, env);
    context.set(execContext, ctx);
    return handler(request, context);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event.cron, env));
  },
} satisfies ExportedHandler<Env>;
