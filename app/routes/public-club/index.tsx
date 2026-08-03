import { Form, data, useNavigation } from "react-router";
import type { Route } from "./+types/index";
import { envContext } from "@worker/loadContext";
import { brand } from "@content/brand";
import { marketingMeta, jsonLd } from "~/seo";
import { tenantDb } from "@db/scope";
import { resolvePublicClubBySlug } from "@db/publicLookup";
import { listMeetings } from "@db/services/meetings";
import { findOrCreatePerson } from "@db/services/people";
import { createMembership } from "@db/services/membership";
import { logInteraction } from "@db/services/interactions";
import { scoreSubmission } from "@domain/spam";
import { newId } from "@domain/ids";
import { hashIp } from "@worker/auth/crypto";
import { checkRateLimit, recordFailure } from "@worker/auth/ratelimit";
import { clientIp } from "@worker/context";
import { Button, Field, Input, Textarea, formatDate } from "~/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return marketingMeta({ title: "Club", description: "", path: "/", noIndex: true });
  const { club } = loaderData;
  return [
    ...marketingMeta({
      title: club.name,
      description:
        club.blurb ??
        `${club.name} — meetings, service projects and how to visit. Guests welcome.`,
      path: `/club/${club.slug}`,
    }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        // Rotary clubs are civic organisations; the schema type exists and
        // search engines treat it meaningfully.
        "@type": "CivicStructure",
        name: club.name,
        description: club.blurb ?? undefined,
        address: club.city
          ? { "@type": "PostalAddress", addressLocality: club.city, addressRegion: club.state ?? undefined }
          : undefined,
        foundingDate: club.charterDate ?? undefined,
      },
    },
  ];
}

/**
 * The one intentional cross-tenant read in the whole app.
 *
 * A public club page is looked up by slug with no session, so it cannot go
 * through TenantDb — the tenant is the *answer*, not the input. Resolving the
 * club first and scoping everything after it to that club's tenant keeps the
 * boundary intact: this loader can read one club's public data and nothing else.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.get(envContext);
  const club = await resolvePublicClubBySlug(env.DB, params.clubSlug);
  if (!club) throw data("No club at that address.", { status: 404 });

  const db = tenantDb(env.DB, club.tenant_id);
  const today = new Date().toISOString().slice(0, 10);

  const [meetings, projects, officers] = await Promise.all([
    listMeetings(db, club.id, { from: today, limit: 6 }),
    db.all<{ name: string; summary: string | null; area_of_focus: string | null; status: string }>(
      "projects",
      {
        columns: "name, summary, area_of_focus, status",
        where: "club_id = ? AND is_public = 1 AND status IN ('active','complete')",
        params: [club.id],
        orderBy: "starts_on DESC",
        limit: 4,
      },
    ),
    // Officers only, and only their name and office. A public page must never
    // become a way to harvest a club's membership list.
    db.raw<{ first_name: string; last_name: string; preferred_name: string | null; role_key: string }>(
      `SELECT p.first_name, p.last_name, p.preferred_name, r.role_key
         FROM role_assignments r
         JOIN people p ON p.id = r.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
        WHERE r.tenant_id = {{tenant}} AND r.scope_type = 'club' AND r.scope_id = ?
          AND r.role_key IN ('club_president','club_secretary','club_treasurer','membership_chair')
          AND (r.starts_on IS NULL OR r.starts_on <= ?)
          AND (r.ends_on IS NULL OR r.ends_on >= ?)`,
      [club.id, today, today],
    ),
  ]);

  const OFFICE_LABELS: Record<string, string> = {
    club_president: "President",
    club_secretary: "Secretary",
    club_treasurer: "Treasurer",
    membership_chair: "Membership Chair",
  };

  return {
    club: {
      name: club.name,
      slug: club.slug,
      city: club.city,
      state: club.state_code,
      charterDate: club.charter_date,
      blurb: club.public_blurb,
      meetingBlurb: club.meeting_blurb,
      websiteUrl: club.website_url,
    },
    meetings: meetings
      .filter((m) => m.is_public === 1 && m.cancelled === 0)
      .map((m) => ({
        date: m.meeting_date,
        time: m.start_time,
        location: m.location,
        topic: m.speaker_topic,
        speaker: m.speaker_name,
      })),
    projects,
    officers: officers.map((o) => ({
      name: `${o.preferred_name || o.first_name} ${o.last_name}`,
      office: OFFICE_LABELS[o.role_key] ?? "Officer",
    })),
  };
}

/**
 * The join form.
 *
 * Spam is accepted with the same friendly thank-you as a real enquiry and
 * filed away for the club to review. Telling a bot it was caught teaches
 * whoever wrote it which rule to change; telling a real person their genuine
 * message "looks like spam" is worse.
 */
export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const THANKS = "Thanks — someone from the club will be in touch. We're glad you're curious about us.";

  const ipKey = await hashIp(clientIp(request), env.IP_HASH_SECRET ?? "dev");
  const limit = await checkRateLimit(env.KV, "joinForm", `${ipKey}:${params.clubSlug}`);
  if (!limit.allowed) return { ok: true, message: THANKS };

  const form = await request.formData();
  const verdict = scoreSubmission({
    name: String(form.get("name") ?? ""),
    email: String(form.get("email") ?? ""),
    message: String(form.get("message") ?? ""),
    honeypot: String(form.get("website") ?? ""),
    elapsedMs: Number(form.get("elapsed") ?? 0),
  });

  // Only a genuine human reaches an error. Spam never does.
  if (!verdict.valid) return { ok: false, message: verdict.message! };

  const club = await resolvePublicClubBySlug(env.DB, params.clubSlug);
  // Even an unknown slug gets the friendly answer — a probe shouldn't be able
  // to tell which clubs exist from the response.
  if (!club) return { ok: true, message: THANKS };

  const now = new Date().toISOString();
  const db = tenantDb(env.DB, club.tenant_id);
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();

  let personId: string | null = null;

  // Real enquiries become a person and a pipeline entry immediately, so the
  // membership chair sees them where they look and the follow-up signal has
  // somebody to name. Spam stays a submission row and touches nothing else.
  if (!verdict.isSpam) {
    const parts = name.split(/\s+/);
    const { person } = await findOrCreatePerson(
      db,
      {
        firstName: parts[0]!,
        lastName: parts.slice(1).join(" ") || "—",
        email,
        phone: String(form.get("phone") ?? "").trim() || null,
        role: "prospective_member",
      },
      now,
    );
    personId = person.id;

    await createMembership(
      db,
      { clubId: club.id, personId: person.id, stage: "lead", source: "public_form" },
      now,
      null,
    );

    await logInteraction(
      db,
      {
        clubId: club.id,
        personId: person.id,
        kind: "signup",
        subject: "Enquired through the club's public page",
        body: message || null,
        sourceModule: "public",
      },
      now,
    );
  }

  await db.insert("join_submissions", {
    id: newId("joinSubmission"),
    club_id: club.id,
    name: name.slice(0, 200),
    email: email.slice(0, 254),
    phone: String(form.get("phone") ?? "").slice(0, 40) || null,
    message: message.slice(0, 4000) || null,
    status: verdict.isSpam ? "spam" : "new",
    spam_score: verdict.score,
    spam_reasons: verdict.reasons.join(","),
    person_id: personId,
    ip_hash: ipKey,
    created_at: now,
  });

  await recordFailure(env.KV, "joinForm", `${ipKey}:${params.clubSlug}`);
  return { ok: true, message: THANKS };
}

export default function PublicClub({ loaderData, actionData }: Route.ComponentProps) {
  const { club, meetings, projects, officers } = loaderData;
  const nav = useNavigation();

  return (
    <div className="min-h-svh bg-ink-50 dark:bg-ink-950">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl dark:text-ink-50">
            {club.name}
          </h1>
          {(club.city || club.meetingBlurb) && (
            <p className="mt-2 text-ink-600 dark:text-ink-400">
              {[club.city && `${club.city}${club.state ? `, ${club.state}` : ""}`, club.meetingBlurb]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </header>

        {club.blurb && (
          <p className="mt-6 text-lg text-pretty text-ink-700 dark:text-ink-300">{club.blurb}</p>
        )}

        {meetings.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Coming up</h2>
            <ul className="mt-4 space-y-3">
              {meetings.map((m) => (
                <li key={m.date} className="border-b border-ink-200 pb-3 dark:border-ink-800">
                  <div className="font-medium text-ink-800 dark:text-ink-200">
                    {formatDate(m.date)}
                    {m.time && <span className="font-normal text-ink-500"> · {m.time}</span>}
                  </div>
                  {(m.topic || m.location) && (
                    <div className="text-sm text-ink-600 dark:text-ink-400">
                      {[m.topic, m.speaker, m.location].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {projects.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">What we're doing</h2>
            <ul className="mt-4 space-y-4">
              {projects.map((p) => (
                <li key={p.name}>
                  <div className="font-medium text-ink-800 dark:text-ink-200">{p.name}</div>
                  {p.summary && (
                    <p className="text-pretty text-ink-600 dark:text-ink-400">{p.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Join ── */}
        <section className="mt-12 rounded-2xl border border-ink-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
          <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
            Come to a meeting
          </h2>
          <p className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">
            Visitors are welcome. Leave your details and someone will get in touch — no
            commitment, and lunch is usually on us the first time.
          </p>

          {actionData?.ok ? (
            <p className="mt-6 rounded-lg bg-steady-500/12 px-4 py-3 text-steady-500">
              {actionData.message}
            </p>
          ) : (
            <Form method="post" className="mt-6 space-y-4">
              {/* Honeypot. Hidden from people, irresistible to naive bots. */}
              <div aria-hidden className="absolute h-0 w-0 overflow-hidden">
                <label htmlFor="website">Website</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              {/* Timing trap: a form completed in under a couple of seconds
                  was not read. Stamped on the client so it reflects the
                  visitor's own clock, not a cached server render. */}
              <input type="hidden" name="elapsed" defaultValue="0" ref={stampElapsed} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name" name="name">
                  <Input id="name" name="name" required autoComplete="name" />
                </Field>
                <Field label="Email" name="email">
                  <Input id="email" name="email" type="email" required autoComplete="email" />
                </Field>
              </div>
              <Field label="Phone" name="phone" hint="Optional.">
                <Input id="phone" name="phone" type="tel" autoComplete="tel" />
              </Field>
              <Field label="Anything you'd like us to know" name="message">
                <Textarea id="message" name="message" rows={3} />
              </Field>

              {actionData && actionData.ok === false && (
                <p className="text-sm text-risk-500">{actionData.message}</p>
              )}

              <Button type="submit" disabled={nav.state === "submitting"}>
                {nav.state === "submitting" ? "Sending…" : "Send"}
              </Button>
            </Form>
          )}
        </section>

        {officers.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">Who to ask</h2>
            <ul className="mt-4 space-y-1 text-ink-700 dark:text-ink-300">
              {officers.map((o) => (
                <li key={o.office}>
                  <span className="text-ink-500">{o.office}</span> — {o.name}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-16 border-t border-ink-200 pt-6 text-sm text-ink-500 dark:border-ink-800">
          <p>
            {club.name} is a member of Rotary International. This page runs on {brand.name}.
          </p>
        </footer>
      </div>
    </div>
  );
}

/**
 * Stamp the render time on the client.
 *
 * The page is server-rendered and edge-cacheable, so a server timestamp would
 * be the cache's age rather than this visitor's. Stamping in the browser is
 * the only reading that means anything.
 */
function stampElapsed(el: HTMLInputElement | null) {
  if (!el) return;
  const start = Date.now();
  const form = el.form;
  if (!form) return;
  form.addEventListener(
    "submit",
    () => {
      el.value = String(Date.now() - start);
    },
    { once: true },
  );
}
