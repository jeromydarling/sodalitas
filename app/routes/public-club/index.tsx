import { Form, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/index";
import { envContext, siteRequestContext, type SiteRequest } from "@worker/loadContext";
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
import { clientIp, type Env } from "@worker/context";
import { capability, checkoutDonation, PaymentUnavailable } from "@db/services/payments";
import { siteFor, pageBySlug, siteConfig, mediaByIds } from "@db/services/sites";
import { parseBlocks, liveDataNeeded } from "@domain/blocks";
import { disclosureFor, analyticsScripts } from "@domain/analytics";
import { SiteShell, RenderBlocks, type RenderContext } from "~/site/render";
import { parseDollars, formatCents } from "@domain/fees";
import { Button, Field, Input, Textarea, formatDate } from "~/ui";

/** The four offices a club shows publicly. Never the whole role table. */
const OFFICE_LABELS: Record<string, string> = {
  club_president: "President",
  club_secretary: "Secretary",
  club_treasurer: "Treasurer",
  membership_chair: "Membership Chair",
};

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return marketingMeta({ title: "Club", description: "", path: "/", noIndex: true });
  const { club } = loaderData;

  if (loaderData.mode === "site") {
    const { page, seo, canonical } = loaderData;
    return [
      ...marketingMeta({
        title: page.title === club.name ? club.name : `${page.title}${seo.titleSuffix ? ` · ${seo.titleSuffix}` : ` · ${club.name}`}`,
        description: page.description || seo.description || `${club.name} — meetings, service projects and how to visit.`,
        path: canonical,
        noIndex: page.noindex,
      }),
      ...(loaderData.faq.length
        ? [
            {
              // A club's own answers, marked up so search engines and AI
              // assistants can quote them. This is the single highest-leverage
              // structured data a club page can carry.
              "script:ld+json": {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: loaderData.faq.map((f) => ({
                  "@type": "Question",
                  name: f.q,
                  acceptedAnswer: { "@type": "Answer", text: f.a },
                })),
              },
            },
          ]
        : []),
      {
        "script:ld+json": {
          "@context": "https://schema.org",
          "@type": "CivicStructure",
          name: club.name,
          url: canonical,
          address: club.city
            ? { "@type": "PostalAddress", addressLocality: club.city, addressRegion: club.state ?? undefined }
            : undefined,
          foundingDate: club.charterDate ?? undefined,
        },
      },
    ];
  }

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
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.get(envContext);
  const club = await resolvePublicClubBySlug(env.DB, params.clubSlug);
  if (!club) throw data("No club at that address.", { status: 404 });

  const db = tenantDb(env.DB, club.tenant_id);
  const today = new Date().toISOString().slice(0, 10);

  // A club that has built a site gets its site. A club that hasn't gets the
  // single page it has always had — the two coexist rather than one replacing
  // the other, so nobody's public page went dark the day this shipped.
  const site = await siteFor(db, club.id);
  const siteReq = context.get(siteRequestContext);

  // A preview link makes drafts visible, but only for the site the token
  // actually resolved to. The siteId check means a valid token for one club
  // cannot be used to read another club's unpublished pages.
  const preview = Boolean(siteReq?.preview && site && siteReq.siteId === site.id);

  if (site && (site.status === "live" || preview)) {
    const page = await pageBySlug(db, site.id, params.pageSlug ?? "");
    if (page && (page.status === "published" || preview)) {
      return loadSitePage(env, db, club, site, page, siteReq, preview, today);
    }
  }
  // A sub-path only exists inside a site. Without one, it is a 404 rather than
  // a silent redirect to the home page: a stale link should say so.
  if (params.pageSlug) throw data("No page at that address.", { status: 404 });

  const [meetings, projects, officers, payments] = await Promise.all([
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
    capability(env, db, club.id),
  ]);

  return {
    mode: "legacy" as const,
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
    donations: payments.donationsEnabled && payments.clubReady
      ? {
          blurb: payments.donationBlurb,
          amounts: payments.suggestedAmounts,
          coverFeeDefault: payments.coverFeeDefault,
          currency: payments.currency,
        }
      : null,
    officers: officers.map((o) => ({
      name: `${o.preferred_name || o.first_name} ${o.last_name}`,
      office: OFFICE_LABELS[o.role_key] ?? "Officer",
    })),
  };
}

/**
 * Load one page of a club's built site.
 *
 * Reads exactly the live data the page's blocks ask for — `liveDataNeeded`
 * walks the blocks first, so a page with no meetings block costs no meetings
 * query. The alternative is fetching everything on every page, which on a
 * four-page site is four times the database work for one page's worth of
 * content.
 */
async function loadSitePage(
  env: Env,
  db: ReturnType<typeof tenantDb>,
  club: NonNullable<Awaited<ReturnType<typeof resolvePublicClubBySlug>>>,
  site: Awaited<ReturnType<typeof siteFor>> & object,
  page: NonNullable<Awaited<ReturnType<typeof pageBySlug>>>,
  siteReq: SiteRequest | null,
  preview: boolean,
  today: string,
) {
  const blocks = parseBlocks(page.blocks_json);
  const needs = liveDataNeeded(blocks);

  // Set by the Worker when the request arrived on the club's own domain. On
  // that host every link is root-relative; on ours everything hangs off
  // /club/<slug>.
  const ownDomain = siteReq?.siteId === site.id ? siteReq.hostname : null;
  const base = ownDomain ? "" : `/club/${club.slug}`;

  const mediaIds = blocks.flatMap((b) => [
    typeof b.mediaId === "string" ? b.mediaId : "",
    ...(Array.isArray(b.items)
      ? (b.items as Record<string, unknown>[]).map((i) => (typeof i.mediaId === "string" ? i.mediaId : ""))
      : []),
  ]);

  const [config, meetings, projects, officers, payments, media] = await Promise.all([
    siteConfig(db, site),
    needs.meetings
      ? listMeetings(db, club.id, { from: today, limit: needs.meetings * 2 })
      : Promise.resolve([]),
    needs.projects
      ? db.all<{ name: string; summary: string | null; area_of_focus: string | null }>("projects", {
          columns: "name, summary, area_of_focus",
          where: "club_id = ? AND is_public = 1 AND status IN ('active','complete')",
          params: [club.id],
          orderBy: "starts_on DESC",
          limit: needs.projects,
        })
      : Promise.resolve([]),
    needs.officers
      ? db.raw<{ first_name: string; last_name: string; preferred_name: string | null; role_key: string }>(
          `SELECT p.first_name, p.last_name, p.preferred_name, r.role_key
             FROM role_assignments r
             JOIN people p ON p.id = r.person_id AND p.tenant_id = {{tenant}} AND p.deleted_at IS NULL
            WHERE r.tenant_id = {{tenant}} AND r.scope_type = 'club' AND r.scope_id = ?
              AND r.role_key IN ('club_president','club_secretary','club_treasurer','membership_chair')
              AND (r.starts_on IS NULL OR r.starts_on <= ?)
              AND (r.ends_on IS NULL OR r.ends_on >= ?)`,
          [club.id, today, today],
        )
      : Promise.resolve([]),
    needs.donate ? capability(env, db, club.id) : Promise.resolve(null),
    mediaByIds(db, mediaIds),
  ]);

  const canonicalBase = ownDomain ? `https://${ownDomain}` : `${env.APP_URL}/club/${club.slug}`;

  return {
    mode: "site" as const,
    // Shown as a banner. Somebody reading a preview must know they are looking
    // at something the public can't see, or they will report a bug against a
    // page that was never live.
    preview,
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
    page: {
      title: page.title,
      description: page.description,
      noindex: page.noindex === 1,
    },
    canonical: page.slug ? `${canonicalBase}/${page.slug}` : canonicalBase || "/",
    base,
    blocks,
    theme: config.theme,
    tokens: config.tokens,
    nav: config.nav,
    seo: config.seo,
    analytics: config.analytics,
    // Pulled out for the FAQPage markup, which has to live in meta().
    faq: blocks
      .filter((b) => b.type === "faq")
      .flatMap((b) => (Array.isArray(b.items) ? (b.items as { q: string; a: string }[]) : []))
      .filter((f) => f.q && f.a)
      .slice(0, 20),
    meetings: meetings
      .filter((m) => m.is_public === 1 && m.cancelled === 0)
      .slice(0, needs.meetings)
      .map((m) => ({
        date: m.meeting_date,
        time: m.start_time,
        location: m.location,
        topic: m.speaker_topic,
        speaker: m.speaker_name,
      })),
    projects: projects.map((p) => ({ name: p.name, summary: p.summary, area: p.area_of_focus })),
    officers: officers.map((o) => ({
      name: `${o.preferred_name || o.first_name} ${o.last_name}`,
      office: OFFICE_LABELS[o.role_key] ?? "Officer",
    })),
    donations:
      payments?.donationsEnabled && payments.clubReady
        ? {
            amounts: payments.suggestedAmounts,
            coverFeeDefault: payments.coverFeeDefault,
            blurb: payments.donationBlurb,
          }
        : null,
    media: [...media.values()].map((m) => ({
      id: m.id,
      url: `${base}/media/${m.id}`,
      alt: m.alt_text ?? "",
      width: m.width,
      height: m.height,
    })),
    disclosure: disclosureFor(config.analytics),
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
  const form = await request.formData();

  if (String(form.get("intent") ?? "") === "donate") {
    return handleDonation(env, params.clubSlug, form, ipKey);
  }

  const limit = await checkRateLimit(env.KV, "joinForm", `${ipKey}:${params.clubSlug}`);
  if (!limit.allowed) return { ok: true, message: THANKS };

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

/**
 * A gift from a stranger.
 *
 * Redirects to the club's own Stripe checkout. Rate-limited per IP per club,
 * because an unthrottled checkout endpoint is a free card-testing service — and
 * it is the club, not us, that would wear the resulting disputes.
 */
async function handleDonation(
  env: Env,
  slug: string,
  form: FormData,
  ipKey: string,
): Promise<{ ok: false; message: string } | Response> {
  const limit = await checkRateLimit(env.KV, "donate", `${ipKey}:${slug}`);
  if (!limit.allowed) {
    return {
      ok: false,
      message: "That's several attempts in a short time. Please try again in a little while.",
    };
  }
  // Counted whether or not it succeeds: the thing being throttled is the rate
  // of checkout creation, not a failure rate.
  await recordFailure(env.KV, "donate", `${ipKey}:${slug}`);

  const club = await resolvePublicClubBySlug(env.DB, slug);
  if (!club) return { ok: false, message: "We couldn't find that club." };

  // "other" hands over to the free-text box; anything else is one of the
  // club's own suggested amounts.
  const chosen = String(form.get("amount") ?? "");
  const raw = chosen === "other" ? String(form.get("customAmount") ?? "") : chosen;
  const amountCents = parseDollars(raw);
  if (amountCents === null || amountCents <= 0) {
    return { ok: false, message: "Please choose or type an amount." };
  }

  try {
    const checkout = await checkoutDonation(
      env,
      tenantDb(env.DB, club.tenant_id),
      {
        clubId: club.id,
        clubName: club.name,
        amountCents,
        coverFee: form.get("coverFee") === "on",
        donorName: String(form.get("donorName") ?? "").slice(0, 200) || null,
        donorEmail: String(form.get("donorEmail") ?? "").slice(0, 254) || null,
      },
      new Date().toISOString(),
    );
    return redirect(checkout.url);
  } catch (err) {
    if (err instanceof PaymentUnavailable) return { ok: false, message: err.message };
    console.error("[donate] checkout failed", err);
    return {
      ok: false,
      message: "We couldn't start that payment. Please try again, or contact the club directly.",
    };
  }
}

export default function PublicClubRoute({ loaderData, actionData }: Route.ComponentProps) {
  if (loaderData.mode === "site") {
    return <BuiltSite loaderData={loaderData} actionData={actionData} />;
  }
  return <LegacyClubPage loaderData={loaderData} actionData={actionData} />;
}

type SiteData = Extract<Route.ComponentProps["loaderData"], { mode: "site" }>;

/**
 * A club's built site.
 *
 * Everything visible here came out of the block registry, so this component
 * has almost nothing to decide. What it does own is the two things that are
 * per-request rather than per-page: whether a form just came back with an
 * answer, and the club's own analytics scripts.
 */
function BuiltSite({
  loaderData,
  actionData,
}: {
  loaderData: SiteData;
  actionData: Route.ComponentProps["actionData"];
}) {
  const navigation = useNavigation();

  const ctx: RenderContext = {
    club: {
      name: loaderData.club.name,
      slug: loaderData.club.slug,
      city: loaderData.club.city,
      state: loaderData.club.state,
    },
    base: loaderData.base,
    meetings: loaderData.meetings,
    projects: loaderData.projects,
    officers: loaderData.officers,
    donations: loaderData.donations,
    media: new Map(loaderData.media.map((m) => [m.id, m])),
    formState: actionData ? { ok: actionData.ok, message: actionData.message } : null,
    submitting: navigation.state === "submitting",
  };

  const scripts = analyticsScripts(loaderData.analytics);

  return (
    <SiteShell
      club={{ name: loaderData.club.name, city: loaderData.club.city, state: loaderData.club.state }}
      tokens={loaderData.tokens}
      theme={loaderData.theme}
      nav={loaderData.nav}
      base={loaderData.base}
      footerNote={
        loaderData.disclosure ? (
          <p className="mt-2 max-w-md text-xs">{loaderData.disclosure}</p>
        ) : null
      }
    >
      {loaderData.preview && (
        <p className="bg-[var(--site-accent-solid)] px-6 py-2.5 text-center text-sm font-medium text-[var(--site-on-accent)]">
          Preview — this is how the site will look. The public can't see it yet.
        </p>
      )}

      <RenderBlocks blocks={loaderData.blocks} ctx={ctx} />

      {/* The club's own trackers.

          This is the one dangerouslySetInnerHTML in the product, and it is
          unavoidable: an inline script's body cannot be expressed any other
          way in React. What makes it safe is that the string is never the
          club's — `analyticsScripts` composes it from a template, substituting
          only an id that has just passed a per-provider regex for the second
          time. There is no field anywhere in this product that accepts markup;
          see domain/analytics.ts for why that was worth the extra work.

          Rendered last so they never hold up the page. */}
      {scripts.map((script, i) =>
        script.src ? (
          <script
            key={`s${i}`}
            async
            src={script.src}
            {...(script.provider === "plausible"
              ? { "data-domain": loaderData.analytics.plausible }
              : {})}
          />
        ) : script.inline ? (
          <script key={`i${i}`} dangerouslySetInnerHTML={{ __html: script.inline }} />
        ) : null,
      )}
    </SiteShell>
  );
}

function LegacyClubPage({
  loaderData,
  actionData,
}: {
  loaderData: Extract<Route.ComponentProps["loaderData"], { mode: "legacy" }>;
  actionData: Route.ComponentProps["actionData"];
}) {
  const { club, meetings, projects, officers, donations } = loaderData;
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

        {donations && (
          <section className="mt-8 rounded-2xl border border-ink-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
            <h2 className="text-xl font-semibold text-ink-900 dark:text-ink-100">
              Support the club's work
            </h2>
            <p className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">
              {donations.blurb ??
                `Gifts go directly to ${club.name} and pay for the projects above.`}
            </p>

            <Form method="post" className="mt-6 space-y-4">
              <input type="hidden" name="intent" value="donate" />

              <fieldset>
                <legend className="text-sm font-medium text-ink-800 dark:text-ink-200">
                  Amount
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {donations.amounts.map((cents, i) => (
                    <label
                      key={cents}
                      className="cursor-pointer rounded-lg border border-ink-300 px-4 py-2 text-ink-800 has-checked:border-brand-500 has-checked:bg-brand-500/10 has-checked:text-brand-600 dark:border-ink-700 dark:text-ink-200"
                    >
                      <input
                        type="radio"
                        name="amount"
                        value={(cents / 100).toFixed(2)}
                        defaultChecked={i === 1 || donations.amounts.length === 1}
                        className="sr-only"
                      />
                      {formatCents(cents, donations.currency)}
                    </label>
                  ))}
                  <label className="cursor-pointer rounded-lg border border-ink-300 px-4 py-2 text-ink-800 has-checked:border-brand-500 has-checked:bg-brand-500/10 has-checked:text-brand-600 dark:border-ink-700 dark:text-ink-200">
                    <input type="radio" name="amount" value="other" className="sr-only" />
                    Another amount
                  </label>
                </div>
              </fieldset>

              <Field label="If another amount, how much?" name="customAmount">
                <Input
                  id="customAmount"
                  name="customAmount"
                  inputMode="decimal"
                  placeholder="75"
                  className="w-32"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name" name="donorName" hint="Optional — so the club can thank you.">
                  <Input id="donorName" name="donorName" autoComplete="name" />
                </Field>
                <Field label="Email" name="donorEmail" hint="For your receipt.">
                  <Input id="donorEmail" name="donorEmail" type="email" autoComplete="email" />
                </Field>
              </div>

              {/* Asked plainly, once. Most people say yes; nobody is nudged, and
                  declining costs the donor nothing and is not commented on. */}
              <label className="flex items-start gap-2.5 text-sm text-ink-700 dark:text-ink-300">
                <input
                  type="checkbox"
                  name="coverFee"
                  defaultChecked={donations.coverFeeDefault}
                  className="mt-0.5 rounded border-ink-300"
                />
                <span>
                  Add the card processing fee so the club receives the full amount
                  <span className="block text-xs text-ink-500">
                    About 3% plus 30¢. Untick it if you'd rather not — the gift is welcome either
                    way.
                  </span>
                </span>
              </label>

              {actionData && actionData.ok === false && (
                <p className="text-sm text-risk-500">{actionData.message}</p>
              )}

              <Button type="submit" disabled={nav.state === "submitting"}>
                {nav.state === "submitting" ? "One moment…" : "Continue to payment"}
              </Button>
              <p className="text-xs text-ink-500">
                Payment is handled by Stripe on the club's own account. {club.name} receives the
                money directly.
              </p>
            </Form>
          </section>
        )}

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
