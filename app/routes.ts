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
  ]),

  // ── Public club pages (the ClubRunner counter) ────────────────────────────
  route("club/:clubSlug", "routes/public-club/index.tsx"),

  // ── Auth ──────────────────────────────────────────────────────────────────
  route("signup", "routes/auth/signup.tsx"),
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
      route("district", "routes/app/district.tsx"),
      route("settings", "routes/app/settings.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
