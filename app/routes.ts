import {
  type RouteConfig,
  index,
  route,
  layout,
  prefix,
} from "@react-router/dev/routes";

export default [
  // ── Public marketing surface ──────────────────────────────────────────────
  layout("routes/marketing/layout.tsx", [
    index("routes/marketing/home.tsx"),
    route("pricing", "routes/marketing/pricing.tsx"),
    route("why-sodalitas", "routes/marketing/why.tsx"),
    route("retention", "routes/marketing/retention.tsx"),
    route("savings", "routes/marketing/savings.tsx"),
    route("compare", "routes/marketing/compare.tsx"),
    route("compare/:slug", "routes/marketing/compare-detail.tsx"),
    route("guides", "routes/marketing/guides.tsx"),
    route("guides/:slug", "routes/marketing/guide-detail.tsx"),
    route("security", "routes/marketing/security.tsx"),
    route("contact", "routes/marketing/contact.tsx"),
  ]),

  // ── Public club pages (the ClubRunner counter) ────────────────────────────
  ...prefix("club/:clubSlug", [
    index("routes/public-club/index.tsx"),
    route("join", "routes/public-club/join.tsx"),
    route("meetings", "routes/public-club/meetings.tsx"),
    route("projects", "routes/public-club/projects.tsx"),
  ]),

  // ── Auth ──────────────────────────────────────────────────────────────────
  route("login", "routes/auth/login.tsx"),
  route("login/check-email", "routes/auth/check-email.tsx"),
  route("auth/magic/:token", "routes/auth/magic.tsx"),
  route("logout", "routes/auth/logout.tsx"),
  route("invite/:token", "routes/auth/invite.tsx"),

  // ── The app ───────────────────────────────────────────────────────────────
  layout("routes/app/layout.tsx", [
    ...prefix("app", [
      index("routes/app/home.tsx"),
      route("people", "routes/app/people.tsx"),
      route("people/:personId", "routes/app/person-detail.tsx"),
      route("membership", "routes/app/membership.tsx"),
      route("meetings", "routes/app/meetings.tsx"),
      route("meetings/:meetingId", "routes/app/meeting-detail.tsx"),
      route("projects", "routes/app/projects.tsx"),
      route("committees", "routes/app/committees.tsx"),
      route("tasks", "routes/app/tasks.tsx"),
      route("dues", "routes/app/dues.tsx"),
      route("district", "routes/app/district.tsx"),
      route("import", "routes/app/import.tsx"),
      route("settings", "routes/app/settings.tsx"),
    ]),
  ]),

  // ── Machine-readable surfaces (served by the Worker, listed for typegen) ──
] satisfies RouteConfig;
