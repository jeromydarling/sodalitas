/**
 * demo.ts — a seeded club that looks like a real one.
 *
 * The demo is the best sales argument this product has, and a demo that is
 * empty is worse than none: a retention tool with nothing to notice looks like
 * a retention tool that doesn't work.
 *
 * So this seeds a club with eight months of history and a deliberate shape —
 * a few members genuinely drifting, two guests who visited and heard nothing
 * back, one member on approved leave who must *not* be flagged, an honorary
 * member who never attends and is fine. Someone clicking around should find the
 * product noticing exactly the things a membership chair would want noticed.
 *
 * Deterministic: a seeded PRNG, so every reset produces the same club and a
 * screenshot taken in March still matches the demo in June.
 */

import { globalDb, tenantDb, type TenantDb } from "../scope";
import { newId } from "@domain/ids";
import { clubSlug } from "./onboarding";
import { shiftDays } from "./membership";

export const DEMO_SLUG = "demo";
export const DEMO_CLUB_NAME = "Rotary Club of Lakeside";

/**
 * Mulberry32. Small, fast, and good enough for placing plausible names and
 * attendance — this is scenery, not cryptography.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Margaret", "David", "Priya", "James", "Aisha", "Robert", "Elena", "Thomas",
  "Grace", "Michael", "Fatima", "Daniel", "Sofia", "William", "Amara", "Joseph",
  "Linh", "Charles", "Rosa", "Kenneth", "Yusuf", "Barbara", "Andrew", "Naomi",
  "Patrick", "Ingrid", "Samuel", "Chiara", "Victor", "Hana", "Gregory", "Beatriz",
  "Malik", "Diane", "Oscar", "Ruth", "Tomas", "Claire", "Ade", "Helen",
  "Nils", "Marta", "Ben", "Sarah", "Omar", "Judith", "Peter", "Lucia",
];

const LAST = [
  "Okonkwo", "Lindqvist", "Nakamura", "Fairweather", "Adeyemi", "Petrov",
  "Castellanos", "Whitfield", "Mbeki", "Hollander", "Rahimi", "Brennan",
  "Vasquez", "Ashford", "Diallo", "Karlsson", "Nguyen", "Thackeray", "Oyelaran",
  "Moretti", "Haddad", "Ferrand", "Kowalski", "Mensah", "Sorensen", "Bright",
  "Alvarez", "Iverson", "Chaudhry", "Delacroix",
];

const EMPLOYERS = [
  "Lakeside Community Bank", "Harbor Dental", "Northshore Legal",
  "Riverbend Manufacturing", "Cedar Street Books", "Lakeside Family Medicine",
  "Quarry Hill Insurance", "Meridian Architects", "Blue Water Grill",
  "Lakeside Public Schools", "Foster & Kline Accounting", "Pinegrove Nursery",
];

const CLASSIFICATIONS = [
  "Banking", "Dentistry", "Law", "Manufacturing", "Retail", "Medicine",
  "Insurance", "Architecture", "Hospitality", "Education", "Accounting",
  "Horticulture", "Real Estate", "Engineering", "Nonprofit Administration",
];

const SPEAKER_TOPICS = [
  "The new lakefront trail",
  "What the food shelf actually needs",
  "Water quality in the harbor",
  "Youth apprenticeships in the trades",
  "Rotary Youth Exchange: a host family's year",
  "Small business after the bypass",
  "Reading tutors: results from last year",
  "The county's housing gap",
];

interface SeededMember {
  personId: string;
  membershipId: string;
  /** Drives how often they turn up in the generated attendance. */
  attendance: number;
  onLeave: boolean;
  honorary: boolean;
}

export interface SeedStats {
  members: number;
  meetings: number;
  attendance_rows: number;
  guests: number;
  committees: number;
  projects: number;
  interactions: number;
  dues: number;
}

/**
 * Wipe and re-seed the demo tenant.
 *
 * Destructive by design and only ever against the tenant flagged `is_demo`.
 * The guard is explicit because a bug here that pointed at a real tenant would
 * delete a club's entire history, and "it only runs on the demo" is a comment,
 * not a safeguard.
 */
export async function reseedDemo(
  env: { DB: D1Database },
  now: string,
): Promise<{ tenantId: string; clubId: string; stats: SeedStats }> {
  const g = globalDb(env.DB);
  const existing = await g.first<{ id: string; is_demo: number }>("tenants", "slug = ?", [DEMO_SLUG]);

  if (existing) {
    if (existing.is_demo !== 1) {
      throw new Error(
        `Refusing to reseed: tenant "${DEMO_SLUG}" is not flagged is_demo. Someone has taken that slug.`,
      );
    }
    await wipeTenant(env.DB, existing.id);
  }

  const tenantId = existing?.id ?? newId("tenant");
  const clubId = newId("club");
  const today = now.slice(0, 10);

  if (!existing) {
    await g.run(
      `INSERT INTO tenants (id, slug, name, kind, plan_key, status, is_demo, timezone, created_at, updated_at)
       VALUES (?, ?, ?, 'club', 'club_standard', 'active', 1, 'America/Chicago', ?, ?)`,
      [tenantId, DEMO_SLUG, DEMO_CLUB_NAME, now, now],
    );
  } else {
    await g.run(`UPDATE tenants SET updated_at = ? WHERE id = ?`, [now, tenantId]);
  }

  await g.run(
    `INSERT INTO clubs (id, tenant_id, ri_number, name, slug, club_type, charter_date, city,
                        state_code, country_code, timezone, public_enabled, public_blurb,
                        meeting_blurb, status, created_at, updated_at)
     VALUES (?, ?, '12345', ?, ?, 'rotary', ?, 'Lakeside', 'MN', 'US', 'America/Chicago', 1, ?, ?, 'active', ?, ?)`,
    [
      clubId, tenantId, DEMO_CLUB_NAME, clubSlug(DEMO_CLUB_NAME),
      `${Number(today.slice(0, 4)) - 68}-04-18`,
      "We're about ninety neighbours who meet on Thursdays, run a few projects a year, and try to be useful to Lakeside. Visitors are welcome any week — lunch is on us the first time.",
      "Thursdays at noon, Blue Water Grill",
      now, now,
    ],
  );

  const db = tenantDb(env.DB, tenantId);
  const stats = await seedClub(db, clubId, today, now);
  return { tenantId, clubId, stats };
}

/** Remove every tenant-owned row. Ordered child-first for the FK constraints. */
async function wipeTenant(db: D1Database, tenantId: string): Promise<void> {
  // Order matters: children before parents. Adding a tenant-owned table means
  // adding it here too, which db/scope.test.ts checks for.
  const ORDER = [
    "communio_replies", "communio_requests", "communio_speakers",
    "communio_shared_events", "communio_shared_signals", "communio_memberships",
    "import_rows", "import_runs", "join_submissions", "ai_invocations",
    "email_unsubscribe_tokens", "email_suppressions", "email_messages",
    "signals", "member_engagement", "club_health_snapshots",
    "audit_log", "invites", "files", "entity_tags", "tags",
    "payments", "dues_invoices", "tasks", "interactions",
    "project_partners", "project_participants", "projects",
    "committee_members", "committees",
    "meeting_attendance", "meetings", "meeting_series",
    "role_assignments", "membership_stage_events", "memberships",
    "household_members", "households", "organizations", "people",
    "clubs", "districts",
  ];
  for (const table of ORDER) {
    await db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(tenantId).run();
  }
}

async function seedClub(
  db: TenantDb,
  clubId: string,
  today: string,
  now: string,
): Promise<SeedStats> {
  const rand = rng(20260803);
  const stats: SeedStats = {
    members: 0, meetings: 0, attendance_rows: 0, guests: 0,
    committees: 0, projects: 0, interactions: 0, dues: 0,
  };

  // ── Members ──
  // A realistic engagement spread, not a uniform one. Most clubs are a solid
  // core, a long middle, and a handful who have quietly stopped coming.
  const MEMBER_COUNT = 46;
  const members: SeededMember[] = [];
  const rows: Record<string, unknown>[] = [];
  const membershipRows: Record<string, unknown>[] = [];

  for (let i = 0; i < MEMBER_COUNT; i++) {
    const personId = newId("person");
    const membershipId = newId("membership");
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 7) % LAST.length]!;

    // Engagement tiers, hand-shaped so the demo shows the product working:
    //   0–3    drifting — these should surface as at-risk
    //   4      on approved leave — must NOT surface
    //   5      honorary, rarely attends — must NOT surface
    //   rest   a normal spread
    let attendance: number;
    let onLeave = false;
    let honorary = false;
    if (i < 4) attendance = 0.05 + rand() * 0.1;
    else if (i === 4) { attendance = 0; onLeave = true; }
    else if (i === 5) { attendance = 0.1; honorary = true; }
    else if (i < 12) attendance = 0.4 + rand() * 0.2;
    else attendance = 0.65 + rand() * 0.3;

    const yearsIn = i === 5 ? 31 : Math.floor(rand() * 22) + 1;
    const joinedOn = shiftDays(today, -(yearsIn * 365 + Math.floor(rand() * 300)));

    members.push({ personId, membershipId, attendance, onLeave, honorary });
    rows.push({
      id: personId,
      first_name: first,
      last_name: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      email_norm: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      phone: `218-555-0${String(100 + i).slice(-3)}`,
      roles: "member",
      employer: EMPLOYERS[i % EMPLOYERS.length]!,
      classification: CLASSIFICATIONS[i % CLASSIFICATIONS.length]!,
      joined_rotary_on: joinedOn,
      city: "Lakeside",
      state_code: "MN",
      do_not_email: 0,
      slug: `${first}-${last}-${personId.slice(-6)}`.toLowerCase(),
      created_at: now,
      updated_at: now,
    });
    membershipRows.push({
      id: membershipId,
      club_id: clubId,
      person_id: personId,
      stage: onLeave ? "leave_of_absence" : "active",
      membership_type: honorary ? "honorary" : "active",
      stage_entered_at: `${joinedOn}T12:00:00.000Z`,
      joined_on: joinedOn,
      is_primary_club: 1,
      source: "import",
      created_at: now,
      updated_at: now,
    });
  }

  await db.insertMany("people", rows);
  await db.insertMany("memberships", membershipRows);
  stats.members = members.length;

  // ── Meetings and attendance, eight months back ──
  const meetingRows: Record<string, unknown>[] = [];
  const attendanceRows: Record<string, unknown>[] = [];
  const meetingIds: string[] = [];

  // Thursdays, walking back from the most recent one.
  let cursor = today;
  while (new Date(`${cursor}T00:00:00Z`).getUTCDay() !== 4) cursor = shiftDays(cursor, -1);

  for (let w = 0; w < 34; w++) {
    const date = shiftDays(cursor, -7 * w);
    const meetingId = newId("meeting");
    meetingIds.push(meetingId);
    meetingRows.push({
      id: meetingId,
      club_id: clubId,
      title: "Weekly meeting",
      meeting_date: date,
      start_time: "12:00",
      location: "Blue Water Grill",
      kind: "regular",
      speaker_name: w % 2 === 0 ? `${FIRST[(w * 3) % FIRST.length]} ${LAST[(w * 5) % LAST.length]}` : null,
      speaker_topic: w % 2 === 0 ? SPEAKER_TOPICS[w % SPEAKER_TOPICS.length]! : null,
      recap_status: "none",
      is_public: 1,
      cancelled: 0,
      created_at: now,
      updated_at: now,
    });

    for (const m of members) {
      if (m.onLeave) continue;
      // Drifting members attended normally until about four months ago, then
      // stopped. A flat low rate would look like someone who never came;
      // the point of the demo is a change the product can catch.
      const recent = w < 17;
      const rate = m.attendance < 0.2 && !recent ? 0.7 : m.attendance;
      const present = rand() < rate;
      attendanceRows.push({
        id: newId("attendance"),
        meeting_id: meetingId,
        club_id: clubId,
        person_id: m.personId,
        status: present ? "present" : "absent",
        is_guest: 0,
        created_at: `${date}T13:00:00.000Z`,
      });
    }
  }

  await db.insertMany("meetings", meetingRows);
  stats.meetings = meetingRows.length;

  // Chunked: 46 members × 34 weeks is over 1,500 rows and one batch that size
  // will blow D1's statement limit.
  for (let i = 0; i < attendanceRows.length; i += 200) {
    await db.insertMany("meeting_attendance", attendanceRows.slice(i, i + 200));
  }
  stats.attendance_rows = attendanceRows.length;

  // ── Guests ──
  // Two who visited and heard nothing back — the highest-value signal in the
  // product, and the one a club is most often quietly losing people to.
  const guests = [
    { first: "Nadia", last: "Osei", weeksAgo: 1, visits: 1, host: members[8]!.personId, followedUp: false },
    { first: "Tomás", last: "Herrera", weeksAgo: 3, visits: 2, host: members[12]!.personId, followedUp: false },
    { first: "Ellen", last: "Vargas", weeksAgo: 6, visits: 3, host: members[9]!.personId, followedUp: true },
  ];

  for (const g of guests) {
    const personId = newId("person");
    await db.insert("people", {
      id: personId,
      first_name: g.first,
      last_name: g.last,
      email: `${g.first.toLowerCase()}@example.com`,
      email_norm: `${g.first.toLowerCase()}@example.com`,
      roles: "guest,prospective_member",
      city: "Lakeside",
      state_code: "MN",
      do_not_email: 0,
      slug: `${g.first}-${g.last}-${personId.slice(-6)}`.toLowerCase(),
      created_at: now,
      updated_at: now,
    });

    const membershipId = newId("membership");
    await db.insert("memberships", {
      id: membershipId,
      club_id: clubId,
      person_id: personId,
      stage: g.followedUp ? "in_conversation" : "guest_attended",
      membership_type: "active",
      stage_entered_at: `${shiftDays(today, -g.weeksAgo * 7)}T12:00:00.000Z`,
      referred_by_person_id: g.host,
      source: "event",
      is_primary_club: 1,
      created_at: now,
      updated_at: now,
    });

    for (let v = 0; v < g.visits; v++) {
      const meetingIdx = g.weeksAgo + v * 2;
      if (meetingIdx >= meetingIds.length) continue;
      await db.insert("meeting_attendance", {
        id: newId("attendance"),
        meeting_id: meetingIds[meetingIdx]!,
        club_id: clubId,
        person_id: personId,
        guest_name: `${g.first} ${g.last}`,
        guest_email: `${g.first.toLowerCase()}@example.com`,
        status: "present",
        is_guest: 1,
        host_person_id: g.host,
        created_at: `${shiftDays(today, -meetingIdx * 7)}T13:00:00.000Z`,
      });
    }

    if (g.followedUp) {
      await db.insert("interactions", {
        id: newId("interaction"),
        club_id: clubId,
        person_id: personId,
        kind: "call",
        source_module: "app",
        subject: "Called to say hello after her visit",
        body: "Happy to come again. Interested in the reading tutors project.",
        outcome: "connected",
        signal_weight: 1,
        is_private: 0,
        occurred_at: `${shiftDays(today, -g.weeksAgo * 7 + 2)}T15:00:00.000Z`,
        created_at: now,
      });
      stats.interactions++;
    }
    stats.guests++;
  }

  // ── Committees ──
  const committees = [
    { name: "Membership", purpose: "Guests, prospective members, and keeping the people we have." },
    { name: "Service Projects", purpose: "Choosing and running the club's projects." },
    { name: "Foundation", purpose: "Giving, grants, and our Foundation relationships." },
    { name: "Public Image", purpose: "The club's public page, press, and social." },
    { name: "Programs", purpose: "Speakers and the weekly program." },
  ];
  let mi = 6;
  for (const c of committees) {
    const committeeId = newId("committee");
    await db.insert("committees", {
      id: committeeId,
      club_id: clubId,
      name: c.name,
      purpose: c.purpose,
      active: 1,
      created_at: now,
      updated_at: now,
    });
    // Roughly half the club sits on something, which is about right and leaves
    // the participation driver with somewhere to go.
    const size = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < size; k++) {
      const m = members[(mi++) % members.length]!;
      await db.insert("committee_members", {
        id: newId("committeeMember"),
        committee_id: committeeId,
        person_id: m.personId,
        role: k === 0 ? "chair" : "member",
        created_at: now,
      });
    }
    stats.committees++;
  }

  // ── Projects ──
  const projects = [
    {
      name: "Lakefront trail cleanup",
      summary: "Two Saturdays clearing and re-gravelling the north section.",
      status: "complete",
      starts: shiftDays(today, -75),
      ends: shiftDays(today, -68),
      served: 0,
      focus: "Environment",
    },
    {
      name: "Reading tutors at Cedar Elementary",
      summary: "Weekly one-to-one reading support for second graders.",
      status: "active",
      starts: shiftDays(today, -200),
      ends: null,
      served: 34,
      focus: "Basic Education and Literacy",
    },
    {
      name: "Winter coat drive",
      summary: "Collection and distribution with the county food shelf.",
      status: "planned",
      starts: shiftDays(today, 40),
      ends: shiftDays(today, 70),
      served: 0,
      focus: "Community Economic Development",
    },
  ];

  for (const p of projects) {
    const projectId = newId("project");
    await db.insert("projects", {
      id: projectId,
      club_id: clubId,
      name: p.name,
      slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      summary: p.summary,
      area_of_focus: p.focus,
      status: p.status,
      starts_on: p.starts,
      ends_on: p.ends,
      budget_cents: 150_000,
      spent_cents: p.status === "complete" ? 132_400 : 0,
      people_served: p.served,
      is_public: 1,
      created_at: now,
      updated_at: now,
    });
    const size = 4 + Math.floor(rand() * 5);
    for (let k = 0; k < size; k++) {
      const m = members[(mi++) % members.length]!;
      await db.insert("project_participants", {
        id: newId("participant"),
        project_id: projectId,
        person_id: m.personId,
        club_id: clubId,
        role: k === 0 ? "lead" : "volunteer",
        hours: p.status === "complete" ? 6 + Math.floor(rand() * 8) : 0,
        created_at: now,
      });
    }
    stats.projects++;
  }

  // ── Dues ──
  // A handful behind, including two of the drifting members — because unpaid
  // dues are usually a symptom of drifting rather than a cause, and the demo
  // should let someone notice that for themselves.
  for (let i = 0; i < members.length; i++) {
    const m = members[i]!;
    if (m.honorary) continue;
    const behind = i < 3 || i === 14 || i === 22;
    await db.insert("dues_invoices", {
      id: newId("invoice"),
      club_id: clubId,
      person_id: m.personId,
      membership_id: m.membershipId,
      period_label: `${today.slice(0, 4)} first half`,
      amount_cents: 15_000,
      paid_cents: behind ? 0 : 15_000,
      due_on: shiftDays(today, -45),
      status: behind ? "open" : "paid",
      created_at: now,
      updated_at: now,
    });
    stats.dues++;
  }

  // ── A few logged conversations ──
  // Only for the engaged half, so the drifting members correctly show as people
  // nobody has spoken to — which is the point.
  for (let i = 12; i < members.length; i += 3) {
    const m = members[i]!;
    await db.insert("interactions", {
      id: newId("interaction"),
      club_id: clubId,
      person_id: m.personId,
      kind: "note",
      source_module: "app",
      subject: "Caught up after the meeting",
      body: "Happy to help with the coat drive in the autumn.",
      signal_weight: 1,
      is_private: 0,
      occurred_at: `${shiftDays(today, -Math.floor(rand() * 40))}T18:00:00.000Z`,
      created_at: now,
    });
    stats.interactions++;
  }

  return stats;
}
