/**
 * roles.ts — Rotary titles on the surface, capabilities underneath.
 *
 * Members see the office they actually hold: Club President, Secretary,
 * Membership Chair, Assistant Governor. The server never checks a title — it
 * checks a capability. That separation is what lets a club give its newsletter
 * editor send rights without inventing a fake office, and what lets Rotary's
 * July leadership turnover be a date change rather than a permissions project.
 *
 * Adding a capability is cheap. Adding a title is cheap. Hard-coding a title
 * check anywhere outside this file is a bug.
 */

// ── Capabilities ──────────────────────────────────────────────────────────────

export const CAPABILITIES = [
  // People & membership
  "people.read",
  "people.write",
  "people.delete",
  "people.export",
  "membership.read",
  "membership.write",
  "membership.approve",       // move a candidate to approved
  "membership.terminate",     // record a resignation, with reason

  // Meetings
  "meetings.read",
  "meetings.write",
  "attendance.record",
  "attendance.read_all",      // everyone's attendance, not just your own

  // Committees & projects
  "committees.read",
  "committees.write",
  "committees.write_own",     // chairs: only committees you chair
  "projects.read",
  "projects.write",
  "projects.write_own",

  // Money
  "dues.read",
  "dues.write",
  "payments.read",
  "payments.write",
  "payments.settings",

  // Communication
  "email.send",
  "email.send_all",           // the whole club, not just your committee
  "email.templates",

  // Tasks & notes
  "tasks.read_all",
  "tasks.write",
  "notes.read_all",           // private notes on members stay private by default

  // Public presence
  "public_page.edit",

  // Data
  "import.run",
  "import.commit",
  "reports.read",
  "reports.export",

  // District
  "district.read",            // rollups across clubs in the district
  "district.write",
  "district.club_read",       // read into an assigned club's detail
  "communio.read",
  "communio.share",
  "communio.govern",

  // Administration
  "settings.read",
  "settings.write",
  "roles.assign",
  "billing.manage",
  "audit.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// ── Titles ────────────────────────────────────────────────────────────────────

export type Scope = "tenant" | "district" | "club" | "committee";

export interface RoleDef {
  key: string;
  /** What a Rotarian sees. Never invent a title Rotary doesn't use. */
  label: string;
  /** Plain-language explanation shown next to the title when assigning it. */
  blurb: string;
  scope: Scope;
  caps: readonly Capability[];
  /** Offices that turn over annually — we prompt to set an end date. */
  annual?: boolean;
}

const MEMBER_BASE = [
  "people.read",
  "membership.read",
  "meetings.read",
  "committees.read",
  "projects.read",
] as const satisfies readonly Capability[];

const OFFICER_BASE = [
  ...MEMBER_BASE,
  "people.write",
  "membership.write",
  "meetings.write",
  "attendance.record",
  "attendance.read_all",
  "tasks.read_all",
  "tasks.write",
  "reports.read",
] as const satisfies readonly Capability[];

export const ROLES: Record<string, RoleDef> = {
  // ── Club offices ────────────────────────────────────────────────────────────
  club_president: {
    key: "club_president",
    label: "Club President",
    blurb: "Full authority over this club. Does not grant district-wide access.",
    scope: "club",
    annual: true,
    caps: [
      ...OFFICER_BASE,
      "people.delete", "people.export",
      "membership.approve", "membership.terminate",
      "committees.write", "projects.write",
      "dues.read", "payments.read",
      "email.send", "email.send_all", "email.templates",
      "notes.read_all",
      "public_page.edit",
      "reports.export",
      "communio.read", "communio.share",
      "settings.read", "settings.write",
      "roles.assign",
      "audit.read",
    ],
  },
  club_president_elect: {
    key: "club_president_elect",
    label: "President-Elect",
    blurb: "Preparing to lead. Sees everything the president sees; changes less.",
    scope: "club",
    annual: true,
    caps: [
      ...OFFICER_BASE,
      "committees.write", "projects.write",
      "dues.read", "payments.read",
      "email.send", "notes.read_all",
      "communio.read",
      "settings.read",
    ],
  },
  club_secretary: {
    key: "club_secretary",
    label: "Club Secretary",
    blurb: "Keeps the roster, the meetings, and the records straight.",
    scope: "club",
    annual: true,
    caps: [
      ...OFFICER_BASE,
      "people.export",
      "membership.approve", "membership.terminate",
      "committees.write",
      "email.send", "email.send_all", "email.templates",
      "import.run", "import.commit",
      "public_page.edit",
      "reports.export",
      "settings.read",
    ],
  },
  club_treasurer: {
    key: "club_treasurer",
    label: "Club Treasurer",
    blurb: "Dues, donations, receipts, and payment settings.",
    scope: "club",
    annual: true,
    caps: [
      ...OFFICER_BASE,
      "dues.read", "dues.write",
      "payments.read", "payments.write", "payments.settings",
      "reports.export",
      "email.send",
    ],
  },
  membership_chair: {
    key: "membership_chair",
    label: "Membership Chair",
    blurb: "Guests, prospects, onboarding, and the members who've gone quiet.",
    scope: "club",
    annual: true,
    caps: [
      ...OFFICER_BASE,
      "membership.approve",
      "email.send",
      "notes.read_all",
      "reports.export",
    ],
  },
  foundation_chair: {
    key: "foundation_chair",
    label: "Foundation Chair",
    blurb: "Giving, grants, and the club's Foundation relationships.",
    scope: "club",
    annual: true,
    caps: [...OFFICER_BASE, "payments.read", "dues.read", "email.send", "reports.export"],
  },
  service_chair: {
    key: "service_chair",
    label: "Service Projects Chair",
    blurb: "Service projects, volunteers, and hours.",
    scope: "club",
    annual: true,
    caps: [...OFFICER_BASE, "projects.write", "committees.write", "email.send"],
  },
  public_image_chair: {
    key: "public_image_chair",
    label: "Public Image Chair",
    blurb: "The club's public page and how the club tells its story.",
    scope: "club",
    annual: true,
    caps: [...MEMBER_BASE, "public_page.edit", "email.send", "projects.write", "reports.read"],
  },
  program_chair: {
    key: "program_chair",
    label: "Program Chair",
    blurb: "Speakers and the weekly program.",
    scope: "club",
    annual: true,
    caps: [...MEMBER_BASE, "meetings.write", "email.send", "communio.read", "tasks.write"],
  },
  committee_chair: {
    key: "committee_chair",
    label: "Committee Chair",
    blurb: "Runs one committee and its projects. Scoped to that committee only.",
    scope: "committee",
    caps: [...MEMBER_BASE, "committees.write_own", "projects.write_own", "tasks.write", "email.send"],
  },
  club_admin: {
    key: "club_admin",
    label: "Club Administrator",
    blurb: "Staff or long-serving volunteer who keeps the system running.",
    scope: "club",
    caps: [
      ...OFFICER_BASE,
      "people.delete", "people.export",
      "committees.write", "projects.write",
      "dues.read", "dues.write", "payments.read", "payments.write",
      "email.send", "email.send_all", "email.templates",
      "import.run", "import.commit",
      "public_page.edit",
      "reports.export",
      "settings.read", "settings.write",
      "roles.assign",
      "audit.read",
    ],
  },
  member: {
    key: "member",
    label: "Member",
    blurb: "Sees the directory, RSVPs, and their own profile and tasks.",
    scope: "club",
    caps: [...MEMBER_BASE, "tasks.write"],
  },

  // ── District offices ────────────────────────────────────────────────────────
  district_governor: {
    key: "district_governor",
    label: "District Governor",
    blurb: "Reads across every club in the district and runs district-level work.",
    scope: "district",
    annual: true,
    caps: [
      ...MEMBER_BASE,
      "district.read", "district.write", "district.club_read",
      "people.write", "membership.write",
      "meetings.write", "committees.write", "projects.write",
      "attendance.read_all",
      "tasks.read_all", "tasks.write",
      "email.send", "email.send_all", "email.templates",
      "reports.read", "reports.export",
      "communio.read", "communio.share", "communio.govern",
      "settings.read", "roles.assign", "audit.read",
    ],
  },
  district_governor_elect: {
    key: "district_governor_elect",
    label: "District Governor-Elect",
    blurb: "Learning the district. Reads widely, changes little.",
    scope: "district",
    annual: true,
    caps: [
      ...MEMBER_BASE,
      "district.read", "district.club_read",
      "attendance.read_all", "tasks.read_all", "tasks.write",
      "reports.read", "communio.read", "email.send",
    ],
  },
  assistant_governor: {
    key: "assistant_governor",
    label: "Assistant Governor",
    blurb: "Supports a handful of clubs. Reads their detail, adds tasks and notes — but does not run them.",
    scope: "district",
    annual: true,
    caps: [
      ...MEMBER_BASE,
      "district.read", "district.club_read",
      "attendance.read_all",
      "tasks.read_all", "tasks.write",
      "reports.read", "communio.read", "email.send",
    ],
  },
  district_membership_chair: {
    key: "district_membership_chair",
    label: "District Membership Chair",
    blurb: "Membership health across the district.",
    scope: "district",
    annual: true,
    caps: [
      ...MEMBER_BASE,
      "district.read", "district.club_read",
      "attendance.read_all", "tasks.read_all", "tasks.write",
      "reports.read", "reports.export", "communio.read", "email.send",
    ],
  },
  district_admin: {
    key: "district_admin",
    label: "District Administrator",
    blurb: "District staff. Manages accounts, billing, and district settings.",
    scope: "tenant",
    caps: [
      ...MEMBER_BASE,
      "district.read", "district.write", "district.club_read",
      "people.write", "people.export",
      "membership.write",
      "meetings.write", "committees.write", "projects.write",
      "attendance.read_all", "tasks.read_all", "tasks.write",
      "email.send", "email.send_all", "email.templates",
      "import.run", "import.commit",
      "reports.read", "reports.export",
      "communio.read", "communio.share", "communio.govern",
      "settings.read", "settings.write",
      "roles.assign", "billing.manage", "audit.read",
    ],
  },
};

export type RoleKey = keyof typeof ROLES;

/** Titles offered when assigning a role at a given scope. */
export function rolesForScope(scope: Scope): RoleDef[] {
  return Object.values(ROLES).filter((r) => r.scope === scope);
}

// ── Resolution ────────────────────────────────────────────────────────────────

/** One row of role_assignments, narrowed to what authority resolution needs. */
export interface Assignment {
  role_key: string;
  scope_type: Scope;
  scope_id: string | null;
  extra_caps: string;
  starts_on: string | null;
  ends_on: string | null;
}

/** An assignment is live when today falls inside its window. */
export function isActive(a: Assignment, today: string): boolean {
  if (a.starts_on && today < a.starts_on) return false;
  if (a.ends_on && today > a.ends_on) return false;
  return true;
}

export interface Authority {
  /** Every capability held anywhere in the tenant. Use for nav visibility only. */
  anyCaps: Set<Capability>;
  /** Capabilities per scope key, e.g. "club:cl_ABC" → Set. */
  byScope: Map<string, Set<Capability>>;
  /** Club ids the user can read at all. */
  readableClubs: Set<string>;
  titles: { roleKey: string; label: string; scopeType: Scope; scopeId: string | null }[];
}

function scopeKey(type: Scope, id: string | null): string {
  return id ? `${type}:${id}` : type;
}

/**
 * Fold a user's assignments into an Authority. Pure — the caller supplies the
 * rows and today's date, so this is trivially testable and has no clock of its own.
 */
export function resolveAuthority(assignments: Assignment[], today: string): Authority {
  const anyCaps = new Set<Capability>();
  const byScope = new Map<string, Set<Capability>>();
  const readableClubs = new Set<string>();
  const titles: Authority["titles"] = [];

  for (const a of assignments) {
    if (!isActive(a, today)) continue;
    const def = ROLES[a.role_key];
    if (!def) continue; // unknown role grants nothing, silently

    const caps = new Set<Capability>(def.caps);
    for (const raw of a.extra_caps.split(",")) {
      const c = raw.trim();
      if (c && (CAPABILITIES as readonly string[]).includes(c)) caps.add(c as Capability);
    }

    const key = scopeKey(a.scope_type, a.scope_id);
    const bucket = byScope.get(key) ?? new Set<Capability>();
    for (const c of caps) {
      bucket.add(c);
      anyCaps.add(c);
    }
    byScope.set(key, bucket);

    if (a.scope_type === "club" && a.scope_id) readableClubs.add(a.scope_id);
    titles.push({
      roleKey: a.role_key,
      label: def.label,
      scopeType: a.scope_type,
      scopeId: a.scope_id,
    });
  }

  return { anyCaps, byScope, readableClubs, titles };
}

/**
 * Does this authority hold `cap` for the given club?
 *
 * Tenant- and district-scoped grants cascade down to every club; a club-scoped
 * grant applies only to its own club. Ask with a clubId whenever you have one —
 * `can(auth, "people.write")` with no club is a nav-level question, not an
 * authorisation decision.
 */
export function can(auth: Authority, cap: Capability, clubId?: string | null): boolean {
  if (auth.byScope.get("tenant")?.has(cap)) return true;
  for (const [key, caps] of auth.byScope) {
    if (key.startsWith("district:") && caps.has(cap)) return true;
  }
  if (clubId) {
    if (auth.byScope.get(`club:${clubId}`)?.has(cap)) return true;
    for (const [key, caps] of auth.byScope) {
      if (key.startsWith("committee:") && caps.has(cap)) {
        // Committee grants are narrower still; the caller checks committee
        // membership itself. Only the *_own capabilities live at this scope.
        if (cap.endsWith("_own")) return true;
      }
    }
    return false;
  }
  return auth.anyCaps.has(cap);
}

/** Throwing variant for service-layer guards. */
export class Forbidden extends Error {
  constructor(public cap: Capability, public clubId?: string | null) {
    super(`Missing capability: ${cap}${clubId ? ` for club ${clubId}` : ""}`);
    this.name = "Forbidden";
  }
}

export function require(auth: Authority, cap: Capability, clubId?: string | null): void {
  if (!can(auth, cap, clubId)) throw new Forbidden(cap, clubId);
}
