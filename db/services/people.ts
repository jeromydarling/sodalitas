/**
 * people.ts — the roster.
 *
 * A person is canonical within a tenant and is never duplicated per club. Their
 * relationship to each club lives in `memberships`. That one rule is why a
 * member who transfers clubs keeps their history instead of becoming a second
 * row that nobody links up.
 *
 * Roles stack. Someone is routinely a member *and* a donor *and* a speaker
 * *and* a sponsor's contact, so roles are a comma-list on the person rather
 * than a table per relationship type — the same shape CROS settled on after
 * trying it the other way.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";

export interface PersonRow {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  email_norm: string | null;
  phone: string | null;
  roles: string;
  employer: string | null;
  job_title: string | null;
  classification: string | null;
  birthday: string | null;
  joined_rotary_on: string | null;
  city: string | null;
  state_code: string | null;
  notes: string | null;
  do_not_email: number;
  slug: string | null;
  photo_key: string | null;
  created_at: string;
  updated_at: string;
}

/** The roles a person can hold. They stack; none excludes another. */
export const PERSON_ROLES = [
  "member",
  "prospective_member",
  "guest",
  "alumni",
  "donor",
  "speaker",
  "sponsor_contact",
  "partner_contact",
  "volunteer",
] as const;

export type PersonRole = (typeof PERSON_ROLES)[number];

export function parseRoles(roles: string): PersonRole[] {
  return roles
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is PersonRole => (PERSON_ROLES as readonly string[]).includes(r));
}

export function addRole(roles: string, role: PersonRole): string {
  const set = new Set(parseRoles(roles));
  set.add(role);
  // Stable order so the stored string doesn't churn on every save.
  return PERSON_ROLES.filter((r) => set.has(r)).join(",");
}

export function removeRole(roles: string, role: PersonRole): string {
  const set = new Set(parseRoles(roles));
  set.delete(role);
  return PERSON_ROLES.filter((r) => set.has(r)).join(",");
}

export function displayName(p: Pick<PersonRow, "first_name" | "last_name" | "preferred_name">): string {
  return `${p.preferred_name || p.first_name} ${p.last_name}`.trim();
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/** Slug for a person's page. Collisions get a short suffix, not a number race. */
export function personSlug(first: string, last: string, id: string): string {
  const base = `${first} ${last}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  // The id suffix makes it unique without a lookup, and keeps the URL stable
  // if someone corrects a spelling later.
  return `${base || "member"}-${id.slice(-6).toLowerCase()}`;
}

// ── Reading ───────────────────────────────────────────────────────────────────

export interface ListOptions {
  /** Free-text over name, email and employer. */
  search?: string;
  /** Restrict to people holding this role. */
  role?: PersonRole;
  /** Restrict to members of one club. */
  clubId?: string;
  limit?: number;
  /** Keyset cursor from a previous page. */
  cursor?: string | null;
}

export interface PersonPage {
  people: PersonRow[];
  /** Pass back as `cursor` for the next page. Null when there are no more. */
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

/**
 * List people, keyset-paginated.
 *
 * `WHERE (last_name, first_name, id) > (?, ?, ?)` rather than OFFSET. OFFSET
 * makes the database walk and discard every skipped row, so page 40 of a
 * district's 4,000 people costs forty times page one. Keyset costs the same at
 * any depth, and doesn't skip or repeat a row when someone is added mid-browse.
 */
export async function listPeople(db: TenantDb, opts: ListOptions = {}): Promise<PersonPage> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 200);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts.cursor) {
    const cur = decodeCursor(opts.cursor);
    if (cur) {
      clauses.push("(last_name, first_name, id) > (?, ?, ?)");
      params.push(cur.lastName, cur.firstName, cur.id);
    }
  }

  if (opts.search) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    clauses.push(
      "(lower(first_name) LIKE ? OR lower(last_name) LIKE ? OR lower(coalesce(email_norm,'')) LIKE ? OR lower(coalesce(employer,'')) LIKE ?)",
    );
    params.push(q, q, q, q);
  }

  if (opts.role) {
    // Comma-list containment. Padding both sides stops "member" matching
    // "prospective_member".
    clauses.push("(',' || roles || ',') LIKE ?");
    params.push(`%,${opts.role},%`);
  }

  if (opts.clubId) {
    clauses.push(
      "id IN (SELECT person_id FROM memberships WHERE club_id = ? AND tenant_id = ?)",
    );
    params.push(opts.clubId, db.tenantId);
  }

  const rows = await db.all<PersonRow>("people", {
    where: clauses.length ? clauses.join(" AND ") : undefined,
    params,
    orderBy: "last_name, first_name, id",
    // Fetch one extra to learn whether another page exists without a COUNT.
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const people = hasMore ? rows.slice(0, limit) : rows;
  const last = people[people.length - 1];

  return {
    people,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

interface Cursor {
  lastName: string;
  firstName: string;
  id: string;
}

function encodeCursor(p: PersonRow): string {
  return btoa(JSON.stringify([p.last_name, p.first_name, p.id]));
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const [lastName, firstName, id] = JSON.parse(atob(raw));
    if (typeof lastName !== "string" || typeof firstName !== "string" || typeof id !== "string") {
      return null;
    }
    return { lastName, firstName, id };
  } catch {
    // A malformed cursor means someone edited the URL. Start from the top
    // rather than erroring — nothing is at stake.
    return null;
  }
}

export function getPerson(db: TenantDb, id: string): Promise<PersonRow | null> {
  return db.byId<PersonRow>("people", id);
}

export function getPersonBySlug(db: TenantDb, slug: string): Promise<PersonRow | null> {
  return db.first<PersonRow>("people", { where: "slug = ?", params: [slug] });
}

export function findByEmail(db: TenantDb, email: string): Promise<PersonRow | null> {
  const norm = normalizeEmail(email);
  if (!norm) return Promise.resolve(null);
  return db.first<PersonRow>("people", { where: "email_norm = ?", params: [norm] });
}

// ── Writing ───────────────────────────────────────────────────────────────────

export interface CreatePersonInput {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  roles?: PersonRole[];
  employer?: string | null;
  jobTitle?: string | null;
  classification?: string | null;
  birthday?: string | null;
  joinedRotaryOn?: string | null;
  city?: string | null;
  stateCode?: string | null;
  notes?: string | null;
}

export async function createPerson(
  db: TenantDb,
  input: CreatePersonInput,
  now: string,
): Promise<PersonRow> {
  const id = newId("person");
  const first = input.firstName.trim();
  const last = input.lastName.trim();

  await db.insert("people", {
    id,
    first_name: first,
    last_name: last,
    preferred_name: input.preferredName?.trim() || null,
    email: input.email?.trim() || null,
    email_norm: normalizeEmail(input.email),
    phone: input.phone?.trim() || null,
    roles: (input.roles ?? ["member"]).join(","),
    employer: input.employer?.trim() || null,
    job_title: input.jobTitle?.trim() || null,
    classification: input.classification?.trim() || null,
    birthday: input.birthday || null,
    joined_rotary_on: input.joinedRotaryOn || null,
    city: input.city?.trim() || null,
    state_code: input.stateCode?.trim() || null,
    notes: input.notes?.trim() || null,
    do_not_email: 0,
    slug: personSlug(first, last, id),
    created_at: now,
    updated_at: now,
  });

  const created = await getPerson(db, id);
  if (!created) throw new Error("person vanished immediately after insert");
  return created;
}

/**
 * Find someone by email or create them, merging in a role.
 *
 * This is what every inbound event calls — a join form, a guest signed in at
 * the door, a payment, an import row. The club should never have to hand-enter
 * somebody the system has already seen, and a guest who later joins should be
 * the same row they always were.
 */
export async function findOrCreatePerson(
  db: TenantDb,
  input: CreatePersonInput & { role: PersonRole },
  now: string,
): Promise<{ person: PersonRow; created: boolean }> {
  const existing = input.email ? await findByEmail(db, input.email) : null;

  if (existing) {
    const roles = addRole(existing.roles, input.role);
    // Only write when something actually changed — an import that touches
    // 400 people shouldn't bump 400 updated_at timestamps for nothing.
    const patch: Record<string, unknown> = {};
    if (roles !== existing.roles) patch.roles = roles;
    if (!existing.phone && input.phone) patch.phone = input.phone.trim();
    if (!existing.employer && input.employer) patch.employer = input.employer.trim();
    if (Object.keys(patch).length > 0) {
      patch.updated_at = now;
      await db.update("people", existing.id, patch);
      return { person: { ...existing, ...patch } as PersonRow, created: false };
    }
    return { person: existing, created: false };
  }

  const person = await createPerson(db, { ...input, roles: [input.role] }, now);
  return { person, created: true };
}

export async function updatePerson(
  db: TenantDb,
  id: string,
  patch: Partial<CreatePersonInput> & { doNotEmail?: boolean },
  now: string,
): Promise<number> {
  const row: Record<string, unknown> = { updated_at: now };
  if (patch.firstName !== undefined) row.first_name = patch.firstName.trim();
  if (patch.lastName !== undefined) row.last_name = patch.lastName.trim();
  if (patch.preferredName !== undefined) row.preferred_name = patch.preferredName?.trim() || null;
  if (patch.email !== undefined) {
    row.email = patch.email?.trim() || null;
    row.email_norm = normalizeEmail(patch.email);
  }
  if (patch.phone !== undefined) row.phone = patch.phone?.trim() || null;
  if (patch.employer !== undefined) row.employer = patch.employer?.trim() || null;
  if (patch.jobTitle !== undefined) row.job_title = patch.jobTitle?.trim() || null;
  if (patch.classification !== undefined) row.classification = patch.classification?.trim() || null;
  if (patch.birthday !== undefined) row.birthday = patch.birthday || null;
  if (patch.joinedRotaryOn !== undefined) row.joined_rotary_on = patch.joinedRotaryOn || null;
  if (patch.city !== undefined) row.city = patch.city?.trim() || null;
  if (patch.stateCode !== undefined) row.state_code = patch.stateCode?.trim() || null;
  if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
  if (patch.doNotEmail !== undefined) row.do_not_email = patch.doNotEmail ? 1 : 0;
  if (patch.roles !== undefined) row.roles = patch.roles.join(",");
  return db.update("people", id, row);
}

/** Retire a person. Soft — their history is the club's history. */
export function removePerson(db: TenantDb, id: string, now: string): Promise<number> {
  return db.remove("people", id, now);
}

// ── Duplicates ────────────────────────────────────────────────────────────────

export interface DuplicateCandidate {
  person: PersonRow;
  reason: string;
  /** 0–1. Above 0.9 we're confident; below 0.7 it's a suggestion only. */
  confidence: number;
}

/**
 * Look for people who might already be this person.
 *
 * Run before creating from an import or a form. Every Rotary club has a "Bob
 * Smith" and a "Robert Smith" who are the same man, and a club that discovers
 * that after two years of split attendance history is a club that stops
 * trusting its own numbers.
 */
export async function findDuplicates(
  db: TenantDb,
  input: { firstName: string; lastName: string; email?: string | null; phone?: string | null },
): Promise<DuplicateCandidate[]> {
  const out: DuplicateCandidate[] = [];
  const seen = new Set<string>();

  const push = (person: PersonRow, reason: string, confidence: number) => {
    if (seen.has(person.id)) return;
    seen.add(person.id);
    out.push({ person, reason, confidence });
  };

  const norm = normalizeEmail(input.email);
  if (norm) {
    const byEmail = await db.first<PersonRow>("people", { where: "email_norm = ?", params: [norm] });
    // Same address is the same person, near enough that we say so plainly.
    if (byEmail) push(byEmail, "Same email address", 1);
  }

  const digits = input.phone?.replace(/\D/g, "");
  if (digits && digits.length >= 10) {
    const tail = digits.slice(-10);
    const byPhone = await db.all<PersonRow>("people", {
      where: "replace(replace(replace(replace(coalesce(phone,''),'-',''),' ',''),'(',''),')','') LIKE ?",
      params: [`%${tail}`],
      limit: 5,
    });
    for (const p of byPhone) push(p, "Same phone number", 0.9);
  }

  const last = input.lastName.trim().toLowerCase();
  const first = input.firstName.trim().toLowerCase();
  if (last) {
    const bySurname = await db.all<PersonRow>("people", {
      where: "lower(last_name) = ?",
      params: [last],
      limit: 20,
    });
    for (const p of bySurname) {
      const pf = p.first_name.toLowerCase();
      const pp = (p.preferred_name ?? "").toLowerCase();
      if (pf === first || pp === first) {
        push(p, "Same name", 0.85);
      } else if (isNicknameOf(first, pf) || isNicknameOf(pf, first)) {
        push(p, `Same surname, and "${p.first_name}" is a common form of "${input.firstName}"`, 0.75);
      } else if (pf.startsWith(first[0] ?? "") && first.length <= 2) {
        // "R. Smith" against "Robert Smith" — worth showing, not worth asserting.
        push(p, "Same surname, matching initial", 0.6);
      }
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

/**
 * The nickname pairs that actually turn up on a Rotary roster.
 *
 * Deliberately a short hand-written list rather than a fuzzy string distance:
 * edit distance thinks "Jon" and "Ron" are near-identical and that "Bill" and
 * "William" are unrelated, which is exactly backwards for this problem.
 */
const NICKNAMES: Record<string, string[]> = {
  robert: ["bob", "rob", "bobby", "robbie"],
  william: ["bill", "will", "billy", "willie"],
  richard: ["rick", "dick", "rich", "richie"],
  james: ["jim", "jimmy", "jamie"],
  john: ["jack", "johnny", "jon"],
  michael: ["mike", "mick", "mikey"],
  charles: ["chuck", "charlie", "chas"],
  thomas: ["tom", "tommy"],
  joseph: ["joe", "joey"],
  edward: ["ed", "eddie", "ted", "ned"],
  margaret: ["maggie", "meg", "peggy", "marge"],
  elizabeth: ["liz", "beth", "betty", "eliza", "lizzie"],
  katherine: ["kate", "kathy", "katie", "kay"],
  catherine: ["cate", "cathy", "cathie", "kit"],
  patricia: ["pat", "patty", "trish"],
  jennifer: ["jen", "jenny"],
  deborah: ["deb", "debbie"],
  susan: ["sue", "susie"],
  barbara: ["barb", "babs"],
  theodore: ["ted", "teddy"],
  anthony: ["tony"],
  daniel: ["dan", "danny"],
  matthew: ["matt"],
  christopher: ["chris"],
  nicholas: ["nick"],
  benjamin: ["ben"],
  alexander: ["alex", "sandy"],
  frederick: ["fred", "freddie"],
  lawrence: ["larry"],
  gerald: ["jerry"],
  ronald: ["ron", "ronnie"],
  donald: ["don", "donnie"],
  kenneth: ["ken", "kenny"],
  stephen: ["steve", "steph"],
  andrew: ["andy", "drew"],
};

export function isNicknameOf(short: string, full: string): boolean {
  return (NICKNAMES[full] ?? []).includes(short);
}
