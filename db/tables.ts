/**
 * tables.ts — the table registry, and which ones belong to a tenant.
 *
 * D1 has no row-level security. In CROS, Postgres RLS was the net under every
 * query and the application filter was called "defensive". Here there is no net:
 * if a query forgets `tenant_id`, one club reads another club's roster.
 *
 * So the boundary is declared here, once, and enforced by db/scope.ts. Adding a
 * tenant-owned table means adding it to TENANT_TABLES in the same commit that
 * creates it — the test in db/scope.test.ts fails otherwise.
 */

/** Tables carrying a `tenant_id` column. Reachable only through TenantDb. */
export const TENANT_TABLES = [
  "tenant_users",
  "districts",
  "clubs",
  "people",
  "households",
  "household_members",
  "organizations",
  "memberships",
  "membership_stage_events",
  "role_assignments",
  "meeting_series",
  "meetings",
  "meeting_attendance",
  "committees",
  "committee_members",
  "projects",
  "project_participants",
  "project_partners",
  "interactions",
  "tasks",
  "dues_invoices",
  "payments",
  "tags",
  "entity_tags",
  "files",
  "invites",
  "audit_log",
  "club_health_snapshots",
  "member_engagement",
  "signals",
  "communio_memberships",
  "communio_shared_signals",
  "communio_shared_events",
  "communio_speakers",
  "communio_requests",
  "communio_replies",
  "email_messages",
  "email_suppressions",
  "email_unsubscribe_tokens",
  "import_runs",
  "import_rows",
  "join_submissions",
  "ai_invocations",
] as const;

export type TenantTable = (typeof TENANT_TABLES)[number];

/**
 * Tables with no tenant column. Each one needs a deliberate reason, written
 * here, because "it isn't tenant-scoped" is exactly the sentence that precedes
 * a data leak.
 */
export const GLOBAL_TABLES = {
  // The tenant list itself.
  tenants: "Tenant registry. Read by slug resolution and billing.",
  // Identity is global: one human, one login, possibly several tenants.
  users: "Login identities, shared across tenants by design.",
  sessions: "Session shadow; carries its own tenant_id but is queried by user.",
  // Communio groups deliberately span tenants — that is the whole feature.
  communio_groups: "Cross-tenant by design. Membership is what scopes access.",
  communio_governance_flags: "Reviewed by group stewards across tenants.",
  // Operational.
  job_runs: "Cron health. No tenant dimension.",
  d1_migrations: "Wrangler's own migration ledger.",
} as const;

export type GlobalTable = keyof typeof GLOBAL_TABLES;

const tenantSet: ReadonlySet<string> = new Set(TENANT_TABLES);

export function isTenantTable(name: string): name is TenantTable {
  return tenantSet.has(name);
}

export function isGlobalTable(name: string): name is GlobalTable {
  return Object.prototype.hasOwnProperty.call(GLOBAL_TABLES, name);
}

/** Tables where a row is retired by stamping `deleted_at`, never removed. */
export const SOFT_DELETE_TABLES: ReadonlySet<string> = new Set([
  "people",
  "organizations",
]);
