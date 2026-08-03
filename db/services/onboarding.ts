/**
 * onboarding.ts — getting a club from nothing to usable.
 *
 * The first ten minutes decide whether a club ever comes back. A Rotary
 * secretary who signs up on a Tuesday evening and lands on an empty screen with
 * a "create your first record" button does not return on Wednesday.
 *
 * So creating a club creates a working club: the account, the person, the
 * office they hold, a weekly meeting series, and the next twelve meetings on
 * the calendar. They arrive at something that already looks like their club.
 */

import { globalDb, tenantDb, type TenantDb } from "../scope";
import { newId } from "@domain/ids";
import { createPerson } from "./people";
import { createMembership } from "./membership";
import { materializeAllSeries } from "./meetings";
import { normalizeEmail } from "@worker/auth/crypto";

export interface CreateClubAccountInput {
  /** The person signing up. */
  email: string;
  firstName: string;
  lastName: string;
  clubName: string;
  /** Rotary International club number, if they know it. Most don't offhand. */
  riNumber?: string | null;
  city?: string | null;
  stateCode?: string | null;
  timezone?: string;
  /** Which office they hold. Defaults to secretary — the usual signer-up. */
  roleKey?: string;
  /** 0 = Sunday. Most clubs meet midweek. */
  meetingWeekday?: number;
  meetingTime?: string;
  meetingLocation?: string | null;
}

export interface CreateClubAccountResult {
  tenantId: string;
  clubId: string;
  userId: string;
  personId: string;
  slug: string;
}

/**
 * Create a tenant, a club, the founding user, and enough scaffolding that the
 * club is immediately usable.
 *
 * Not wrapped in a transaction: D1 has no interactive transactions, and a
 * batch would have to know every id up front. Instead the order is chosen so a
 * failure part-way leaves something recoverable — tenant and club first, then
 * the user's access, then the optional extras. A club with no meeting series is
 * fine; a meeting series with no club is not.
 */
export async function createClubAccount(
  env: { DB: D1Database },
  input: CreateClubAccountInput,
  now: string,
): Promise<CreateClubAccountResult> {
  const g = globalDb(env.DB);
  const emailNorm = normalizeEmail(input.email);
  const tenantId = newId("tenant");
  const clubId = newId("club");
  const slug = await uniqueClubSlug(env.DB, input.clubName);

  await g.run(
    `INSERT INTO tenants (id, slug, name, kind, plan_key, status, is_demo, timezone, created_at, updated_at)
     VALUES (?, ?, ?, 'club', 'club_starter', 'active', 0, ?, ?, ?)`,
    [tenantId, slug, input.clubName.trim(), input.timezone ?? "America/Chicago", now, now],
  );

  await g.run(
    `INSERT INTO clubs (id, tenant_id, ri_number, name, slug, club_type, city, state_code,
                        timezone, public_enabled, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'rotary', ?, ?, ?, 1, 'active', ?, ?)`,
    [
      clubId, tenantId, input.riNumber ?? null, input.clubName.trim(), slug,
      input.city ?? null, input.stateCode ?? null, input.timezone ?? "America/Chicago", now, now,
    ],
  );

  // Reuse an existing login if this address already has one — somebody who runs
  // two clubs shouldn't end up with two accounts and two magic links.
  let userId: string;
  const existingUser = await g.first<{ id: string }>("users", "email_norm = ?", [emailNorm]);
  if (existingUser) {
    userId = existingUser.id;
  } else {
    userId = newId("user");
    await g.run(
      `INSERT INTO users (id, email, email_norm, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, input.email.trim(), emailNorm, `${input.firstName} ${input.lastName}`.trim(), now, now],
    );
  }

  await g.run(
    `INSERT INTO tenant_users (tenant_id, user_id, status, created_at) VALUES (?, ?, 'active', ?)`,
    [tenantId, userId, now],
  );

  const db = tenantDb(env.DB, tenantId);

  const person = await createPerson(
    db,
    {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      roles: ["member"],
      city: input.city ?? null,
      stateCode: input.stateCode ?? null,
    },
    now,
  );

  await db.update("people", person.id, { user_id: userId, updated_at: now });

  await createMembership(
    db,
    {
      clubId,
      personId: person.id,
      stage: "active",
      joinedOn: now.slice(0, 10),
      source: "signup",
    },
    now,
    userId,
  );

  // The founder gets their stated office plus club administration, so they can
  // set the club up without first having to grant themselves permission to.
  await db.insert("role_assignments", {
    id: newId("role"),
    user_id: userId,
    person_id: person.id,
    role_key: input.roleKey ?? "club_secretary",
    scope_type: "club",
    scope_id: clubId,
    extra_caps: "",
    created_at: now,
    updated_at: now,
  });
  await db.insert("role_assignments", {
    id: newId("role"),
    user_id: userId,
    person_id: person.id,
    role_key: "club_admin",
    scope_type: "club",
    scope_id: clubId,
    extra_caps: "",
    created_at: now,
    updated_at: now,
  });

  // A weekly series and twelve meetings on the calendar. A club with an empty
  // calendar has nothing to record attendance against, and attendance is the
  // input everything else depends on.
  const seriesId = newId("meetingSeries");
  await db.insert("meeting_series", {
    id: seriesId,
    club_id: clubId,
    name: "Weekly meeting",
    rrule_weekday: input.meetingWeekday ?? 4, // Thursday
    rrule_interval: 1,
    start_time: input.meetingTime ?? "12:00",
    duration_min: 60,
    location: input.meetingLocation ?? null,
    active: 1,
    created_at: now,
    updated_at: now,
  });
  await materializeAllSeries(db, now.slice(0, 10), now);

  return { tenantId, clubId, userId, personId: person.id, slug };
}

/** Slugify a club name into something that reads well in a public URL. */
export function clubSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      // "Rotary Club of Duluth" → "duluth". The words every club shares carry
      // no information and make every URL look the same.
      .replace(/\b(the|rotary|rotaract|interact|club|of|inc)\b/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "club"
  );
}

async function uniqueClubSlug(db: D1Database, name: string): Promise<string> {
  const base = clubSlug(name);
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await db
      .prepare(`SELECT 1 AS x FROM clubs WHERE slug = ? UNION SELECT 1 FROM tenants WHERE slug = ?`)
      .bind(candidate, candidate)
      .first<{ x: number }>();
    if (!taken) return candidate;
  }
  // Twenty-five clubs named the same thing is implausible; fall back to
  // something guaranteed unique rather than looping forever.
  return `${base}-${newId("club").slice(-6).toLowerCase()}`;
}

// ── Setup progress ────────────────────────────────────────────────────────────

export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
  /** Why it matters. Shown when it isn't done yet. */
  why: string;
  href: string;
}

/**
 * What's left before the club gets value from this.
 *
 * Ordered by what unlocks the most: without members there is nothing to score,
 * and without attendance the retention signals have nothing to read. A club
 * that stops after step one gets a directory; a club that finishes gets the
 * thing it's paying for.
 */
export async function setupProgress(
  db: TenantDb,
  clubId: string,
): Promise<{ steps: SetupStep[]; complete: boolean }> {
  // Four separate counts over four tables. Parallel rather than UNIONed:
  // D1 caps a compound SELECT at five terms and this would sit one under it,
  // which is the kind of margin that breaks the day someone adds a fifth step.
  const [members, attendance, officers, committees] = await Promise.all([
    db.count("memberships", {
      where: "club_id = ? AND stage IN ('active','at_risk','leave_of_absence')",
      params: [clubId],
    }),
    db.count("meeting_attendance", { where: "club_id = ?", params: [clubId] }),
    db.count("role_assignments", {
      where: "scope_type = 'club' AND scope_id = ?",
      params: [clubId],
    }),
    db.count("committees", { where: "club_id = ?", params: [clubId] }),
  ]);
  const n = (k: string) =>
    ({ members, attendance, officers, committees })[k] ?? 0;

  const steps: SetupStep[] = [
    {
      key: "members",
      label: "Add your members",
      // Two is the founder plus one — a club with only its founder hasn't
      // really started.
      done: n("members") > 2,
      why: "Import a CSV from your current system, or add a few by hand. Nothing else works until the roster is here.",
      href: "/app/import",
    },
    {
      key: "attendance",
      label: "Record one meeting's attendance",
      done: n("attendance") > 0,
      why: "Attendance is what tells us who's drifting. One meeting is enough to start.",
      href: "/app/meetings",
    },
    {
      key: "officers",
      label: "Assign your officers",
      done: n("officers") > 2,
      why: "So the right people can do the right things, and so next July's handover is a date change rather than a project.",
      href: "/app/settings",
    },
    {
      key: "committees",
      label: "Set up your committees",
      done: n("committees") > 0,
      why: "Members on a committee are markedly more likely to still be here next year. This is the lever you can actually pull.",
      href: "/app/committees",
    },
  ];

  return { steps, complete: steps.every((s) => s.done) };
}
