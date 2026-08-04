import { type RouteConfig, index, route, layout, prefix } from "@react-router/dev/routes";

/**
 * Routes are added as they're built. A route that renders "coming soon" is
 * worse than no route: it gets indexed, it gets linked, and it teaches people
 * the product is thinner than it is.
 */
export default [
  // ── Public marketing ──────────────────────────────────────────────────────
  layout("routes/marketing/layout.tsx", [
    index("routes/marketing/home.tsx"),
    route("pricing", "routes/marketing/pricing.tsx"),
    route("retention", "routes/marketing/retention.tsx"),
    route("compare", "routes/marketing/compare.tsx"),
    route("features", "routes/marketing/features.tsx"),
    route("features/:featureSlug", "routes/marketing/feature-detail.tsx"),
    route("integrations", "routes/marketing/integrations.tsx"),
    route("guides", "routes/marketing/guides.tsx"),
    route("guides/:guideSlug", "routes/marketing/guide-detail.tsx"),
    route("about", "routes/marketing/about.tsx"),
    route("demo", "routes/marketing/demo.tsx"),
    route("contact", "routes/marketing/contact.tsx"),
    route("legal/:legalSlug", "routes/marketing/legal.tsx"),
  ]),

  // ── Public club pages (the ClubRunner counter) ────────────────────────────
  //
  // One file serves three shapes: the club's built site, a page within it, and
  // the single page a club had before websites existed. Same file because they
  // share the join form and the donation flow, and duplicating those to split
  // the routes would mean two places to keep the spam defences in step.
  //
  // A club on its own domain is rewritten into these same paths by the Worker,
  // so `rotaryclubofsomewhere.org/visit` and `/club/somewhere/visit` run
  // exactly the same code.
  route("club/:clubSlug", "routes/public-club/index.tsx", { id: "club-home" }),
  route("club/:clubSlug/media/:mediaId", "routes/public-club/media.tsx"),
  route("club/:clubSlug/:pageSlug", "routes/public-club/index.tsx", { id: "club-page" }),

  // ── Where Stripe sends a payer back to. No layout: these are the last thing
  //    somebody sees after handing over money, and they load in one hop.
  route("pay/thanks", "routes/pay/thanks.tsx"),
  route("pay/cancelled", "routes/pay/cancelled.tsx"),

  // ── Opt-out. No session, no layout: every non-transactional email links
  //    here, and it has to work for somebody who wants nothing to do with us.
  route("unsubscribe/:token", "routes/unsubscribe.tsx"),

  // POST-only: a GET here would hand a session to every link prefetcher.
  route("demo/enter", "routes/demo-enter.tsx"),

  // ── Auth ──────────────────────────────────────────────────────────────────
  route("signup", "routes/auth/signup.tsx"),
  route("invite/:token", "routes/auth/invite.tsx"),
  route("login", "routes/auth/login.tsx"),
  route("auth/magic/:token", "routes/auth/magic.tsx"),
  route("logout", "routes/auth/logout.tsx"),

  // ── The app ───────────────────────────────────────────────────────────────
  layout("routes/app/layout.tsx", [
    ...prefix("app", [
      index("routes/app/home.tsx"),
      route("people", "routes/app/people.tsx"),
      route("people/:personId", "routes/app/person-detail.tsx"),
      route("membership", "routes/app/membership.tsx"),
      route("meetings", "routes/app/meetings.tsx"),
      route("meetings/:meetingId", "routes/app/meeting-detail.tsx"),
      route("tasks", "routes/app/tasks.tsx"),
      route("import", "routes/app/import.tsx"),
      route("committees", "routes/app/committees.tsx"),
      route("projects", "routes/app/projects.tsx"),
      route("events", "routes/app/events.tsx"),
      route("events/:eventId", "routes/app/event-detail.tsx"),
      route("documents", "routes/app/documents.tsx"),
      // Not a page — it streams the file. Under /app so it goes through the
      // same session and capability check as everything else.
      route("documents/:documentId", "routes/app/document-download.tsx"),
      route("dues", "routes/app/dues.tsx"),
      route("communio", "routes/app/communio.tsx"),
      // The website builder. `site/brand` and `site/domains` come before
      // `site/:pageId` so those two words can never be read as a page id.
      route("site", "routes/app/site.tsx"),
      route("site/brand", "routes/app/site-brand.tsx"),
      route("site/domains", "routes/app/site-domains.tsx"),
      route("site/media", "routes/app/site-media.tsx"),
      route("site/:pageId", "routes/app/site-page.tsx"),
      route("district", "routes/app/district.tsx"),
      route("settings", "routes/app/settings.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
