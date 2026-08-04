/**
 * events.tsx — the club's public events, and the form that fills them.
 *
 * One file for the list and the detail because they share the loader's club
 * resolution, the site shell, and the fact that neither has a session. A
 * visitor booking a table at a fundraiser is a stranger to us; they may or may
 * not be somebody the club already knows, and `register` decides that by
 * matching the email rather than by asking them to have an account.
 *
 * What this page owes the payer, before they hand over a card:
 *
 *   - What it costs, itemised, including the card fee if they choose to cover
 *     it and our fee, which is stated rather than buried.
 *   - Whether there's actually room, or whether they're joining a waiting list
 *     — and if it's a waiting list, that nothing will be charged.
 *   - The club's refund policy, if it has one. A policy nobody was shown is a
 *     chargeback with extra steps.
 */

import { Form, data, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/events";
import { envContext, siteRequestContext } from "@worker/loadContext";
import { marketingMeta } from "~/seo";
import { tenantDb } from "@db/scope";
import { resolvePublicClubBySlug } from "@db/publicLookup";
import {
  availability,
  eventBySlug,
  listEvents,
  listQuestions,
  listTicketTypes,
  register,
  toQuestions,
  toTicketTypes,
} from "@db/services/events";
import { checkoutTickets, PaymentUnavailable, capability } from "@db/services/payments";
import { siteFor, siteConfig } from "@db/services/sites";
import type { OrderLine } from "@domain/events";
import { EVENT_FEE_SUMMARY } from "@domain/pricing";
import { DEFAULT_TOKENS } from "@domain/palette";
import { checkRateLimit, recordFailure } from "@worker/auth/ratelimit";
import { hashIp } from "@worker/auth/crypto";
import { clientIp } from "@worker/context";
import { SiteShell } from "~/site/render";
import { Button, Field, Input, Textarea, formatDate, money } from "~/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return marketingMeta({ title: "Events", description: "", path: "/", noIndex: true });
  const { club, event } = loaderData;
  return marketingMeta({
    title: event ? `${event.title} · ${club.name}` : `Events · ${club.name}`,
    description: event
      ? (event.summary ?? `${event.title} — ${formatDate(event.startsOn)}. Register with ${club.name}.`)
      : `What's on at ${club.name}. Everyone welcome.`,
    path: `/club/${club.slug}/events${event ? `/${event.slug}` : ""}`,
  });
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.get(envContext);
  const club = await resolvePublicClubBySlug(env.DB, params.clubSlug);
  if (!club) throw data("No club at that address.", { status: 404 });

  const db = tenantDb(env.DB, club.tenant_id);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const siteReq = context.get(siteRequestContext);
  const site = await siteFor(db, club.id);
  const ownDomain = site && siteReq?.siteId === site.id ? siteReq.hostname : null;
  const base = ownDomain ? "" : `/club/${club.slug}`;

  const config = site ? await siteConfig(db, site) : null;
  const shell = {
    tokens: config?.tokens ?? DEFAULT_TOKENS,
    theme: config?.theme ?? ("classic" as const),
    nav: config?.nav ?? [],
  };

  const clubRef = {
    name: club.name,
    slug: club.slug,
    city: club.city,
    state: club.state_code,
  };

  // ── One event ──
  if (params.eventSlug) {
    const event = await eventBySlug(db, club.id, params.eventSlug);
    // A members-only event is not a public page. A draft never was one. A
    // cancelled event still is, deliberately — a cancelled event that vanishes
    // leaves people turning up.
    if (!event || event.visibility !== "public" || event.status === "draft") {
      throw data("No event at that address.", { status: 404 });
    }

    const [typeRows, questionRows, avail, pay] = await Promise.all([
      listTicketTypes(db, event.id),
      listQuestions(db, event.id),
      availability(db, event, now),
      capability(env, db, club.id),
    ]);

    const types = toTicketTypes(typeRows).filter((t) => t.active && !t.membersOnly);
    const paid = types.some((t) => t.priceCents > 0);

    return {
      club: clubRef,
      base,
      shell,
      today,
      list: null,
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        summary: event.summary,
        description: event.description,
        startsOn: event.starts_on,
        startsAtTime: event.starts_at_time,
        endsOn: event.ends_on,
        endsAtTime: event.ends_at_time,
        location: event.location,
        address: event.address,
        mapUrl: event.map_url,
        status: event.status,
        refundPolicy: event.refund_policy,
        allowGuests: event.allow_guests === 1,
        maxGuests: event.max_guests,
        closesOn: event.registration_closes_on,
      },
      availability: avail,
      types: types.map((t) => ({
        id: t.id,
        name: t.name,
        description: typeRows.find((r) => r.id === t.id)?.description ?? null,
        priceCents: t.priceCents,
        seatsEach: t.seatsEach,
        maxPerOrder: t.maxPerOrder,
      })),
      questions: toQuestions(questionRows),
      // Cards are only offered when the club can actually take one. A paid
      // event on a club that hasn't linked Stripe says so plainly instead of
      // sending somebody to a checkout that 500s.
      canTakeCards: pay.clubReady,
      needsCards: paid,
      coverFeeDefault: pay.coverFeeDefault,
      feeSummary: EVENT_FEE_SUMMARY,
    };
  }

  // ── The list ──
  const events = await listEvents(db, club.id, { from: today, status: "open", limit: 24 });
  const visible = events.filter((e) => e.visibility === "public");

  return {
    club: clubRef,
    base,
    shell,
    today,
    event: null,
    list: visible.map((e) => ({
      slug: e.slug,
      title: e.title,
      summary: e.summary,
      startsOn: e.starts_on,
      startsAtTime: e.starts_at_time,
      location: e.location,
    })),
    availability: null,
    types: [],
    questions: [],
    canTakeCards: false,
    needsCards: false,
    coverFeeDefault: false,
    feeSummary: EVENT_FEE_SUMMARY,
  };
}

/**
 * Take a booking.
 *
 * Rate-limited per IP per club for the same reason the donation form is: an
 * unthrottled endpoint that creates Stripe checkouts is a free card-testing
 * service, and it is the club that wears the disputes.
 */
export async function action({ params, request, context }: Route.ActionArgs) {
  const env = context.get(envContext);
  const club = await resolvePublicClubBySlug(env.DB, params.clubSlug);
  if (!club) return { ok: false as const, message: "We couldn't find that club." };
  if (!params.eventSlug) return { ok: false as const, message: "We didn't recognise that." };

  const ipKey = await hashIp(clientIp(request), env.IP_HASH_SECRET ?? "dev");
  const limit = await checkRateLimit(env.KV, "register", `${ipKey}:${params.clubSlug}`);
  if (!limit.allowed) {
    return {
      ok: false as const,
      message: "That's several attempts in a short time. Please try again in a little while.",
    };
  }
  await recordFailure(env.KV, "register", `${ipKey}:${params.clubSlug}`);

  const db = tenantDb(env.DB, club.tenant_id);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const event = await eventBySlug(db, club.id, params.eventSlug);
  if (!event || event.visibility !== "public" || event.status === "draft") {
    return { ok: false as const, message: "That event isn't taking registrations." };
  }

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  if (!name) return { ok: false as const, message: "Please tell the club your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false as const, message: "That email address doesn't look right." };
  }

  const typeRows = await listTicketTypes(db, event.id);
  const lines: OrderLine[] = typeRows
    .map((t) => ({ ticketTypeId: t.id, quantity: Number(form.get(`qty_${t.id}`) ?? 0) || 0 }))
    .filter((l) => l.quantity > 0);
  if (lines.length === 0) {
    return { ok: false as const, message: "Choose at least one ticket." };
  }

  const questionRows = await listQuestions(db, event.id);
  const answers: Record<string, unknown> = {};
  for (const q of questionRows) {
    const value = form.getAll(`q_${q.id}`);
    answers[q.id] = value.length > 1 ? value.map(String) : String(value[0] ?? "");
  }

  // Somebody the club already knows keeps their history. Somebody it doesn't
  // stays a stranger — we don't manufacture a contact record out of a ticket.
  const known = await db.first<{ id: string }>("people", {
    columns: "id",
    where: "email_norm = ?",
    params: [email.toLowerCase()],
  });

  const coverFee = form.get("coverFee") === "on";

  const result = await register(
    db,
    {
      event,
      lines,
      name,
      email,
      phone: String(form.get("phone") ?? "").trim() || null,
      guests: Number(form.get("guests") ?? 0) || 0,
      guestNames: String(form.get("guestNames") ?? "").trim() || null,
      answers,
      personId: known?.id ?? null,
      // A public page is a public page. Members-only tickets are filtered out
      // of it entirely, so nothing here can claim a member price.
      isMember: false,
      coverCardFee: coverFee,
      ipHash: ipKey,
    },
    now,
    today,
  );

  if (!result.ok) return { ok: false as const, message: result.reason };

  if (result.waitlisted) {
    return {
      ok: true as const,
      message:
        "You're on the waiting list, and nothing has been charged. The club will be in touch the moment a place opens up.",
      ticketCode: result.registration.ticket_code,
    };
  }

  if (result.chargedCents === 0) {
    return {
      ok: true as const,
      message: "You're booked in. Keep this reference — it's what gets you in at the door.",
      ticketCode: result.registration.ticket_code,
    };
  }

  try {
    const checkout = await checkoutTickets(
      env,
      db,
      {
        clubId: club.id,
        clubName: club.name,
        registrationId: result.registration.id,
        eventTitle: event.title,
        amountCents: result.registration.amount_cents,
        coverFee,
        platformFeeCents: result.platformFeeCents,
        personId: known?.id ?? null,
        payerName: name,
        payerEmail: email,
      },
      now,
    );
    // Written before the redirect so the webhook can find its way back here.
    await db.update("event_registrations", result.registration.id, {
      checkout_id: checkout.checkoutId,
      updated_at: now,
    });
    return redirect(checkout.url);
  } catch (err) {
    // The seat is held as `pending` and will release itself. Say what happened
    // rather than leaving somebody wondering whether they paid.
    const message =
      err instanceof PaymentUnavailable
        ? err.message
        : "We couldn't start that payment. Nothing has been charged — please try again, or contact the club.";
    if (!(err instanceof PaymentUnavailable)) console.error("[events] checkout failed", err);
    return { ok: false as const, message };
  }
}

export default function PublicEvents({ loaderData, actionData }: Route.ComponentProps) {
  const { club, base, shell, event } = loaderData;

  return (
    <SiteShell
      club={{ name: club.name, city: club.city, state: club.state }}
      tokens={shell.tokens}
      theme={shell.theme}
      nav={shell.nav}
      base={base}
    >
      {event ? (
        <EventPage loaderData={loaderData} actionData={actionData} />
      ) : (
        <EventList loaderData={loaderData} />
      )}
    </SiteShell>
  );
}

type Data = Route.ComponentProps["loaderData"];

function EventList({ loaderData }: { loaderData: Data }) {
  const { list, base, club } = loaderData;

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">What's on</h1>
      {!list || list.length === 0 ? (
        <p className="mt-4 text-lg opacity-70">
          Nothing on the calendar just now. {club.name} would still be glad to see you at a
          meeting — <a href={`${base || "/"}`} className="underline">have a look</a>.
        </p>
      ) : (
        <ul className="mt-10 space-y-6">
          {list.map((e) => (
            <li key={e.slug} className="border-b pb-6 last:border-0" style={{ borderColor: "color-mix(in oklab, currentColor 12%, transparent)" }}>
              <a href={`${base}/events/${e.slug}`} className="group block">
                <div className="text-sm font-medium uppercase tracking-wide opacity-60">
                  {[formatDate(e.startsOn), e.startsAtTime].filter(Boolean).join(" · ")}
                </div>
                <h2 className="mt-1 text-xl font-semibold group-hover:underline">{e.title}</h2>
                {e.summary && <p className="mt-1 opacity-75">{e.summary}</p>}
                {e.location && <p className="mt-1 text-sm opacity-60">{e.location}</p>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EventPage({ loaderData, actionData }: { loaderData: Data; actionData: Route.ComponentProps["actionData"] }) {
  const { event, types, questions, availability: avail, canTakeCards, needsCards, coverFeeDefault, base, today, feeSummary } =
    loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  if (!event) return null;

  const cancelled = event.status === "cancelled";
  const closed =
    event.status === "closed" ||
    (event.closesOn !== null && event.closesOn < today) ||
    event.startsOn < today;
  const full = avail?.full === true;
  const cheapest = types.length ? Math.min(...types.map((t) => t.priceCents)) : 0;
  const anyPaid = types.some((t) => t.priceCents > 0);

  return (
    <article className="mx-auto max-w-2xl px-6 py-16">
      <a href={`${base}/events`} className="text-sm opacity-60 hover:underline">
        ← All events
      </a>

      <div className="mt-6 text-sm font-medium uppercase tracking-wide opacity-60">
        {[formatDate(event.startsOn), event.startsAtTime].filter(Boolean).join(" · ")}
      </div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{event.title}</h1>
      {event.summary && <p className="mt-3 text-lg opacity-80">{event.summary}</p>}

      {(event.location || event.address) && (
        <p className="mt-4 opacity-75">
          {[event.location, event.address].filter(Boolean).join(" — ")}
          {event.mapUrl && (
            <>
              {" "}
              <a href={event.mapUrl} rel="noreferrer" className="underline">
                map
              </a>
            </>
          )}
        </p>
      )}

      {event.description && (
        <div className="mt-8 space-y-4 leading-relaxed opacity-90">
          {event.description.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}

      {/* ── The state of the room, said before the form ── */}
      {cancelled ? (
        <Notice tone="stop">
          This event has been cancelled. If you had booked a place, the club will be in touch.
        </Notice>
      ) : closed ? (
        <Notice tone="quiet">Registrations for this one have closed.</Notice>
      ) : full ? (
        <Notice tone="quiet">
          Every place is taken. You can still join the waiting list below — nothing will be
          charged unless a place opens up and you take it.
        </Notice>
      ) : avail && avail.remaining !== null && avail.remaining <= 10 ? (
        <Notice tone="quiet">
          {avail.remaining} {avail.remaining === 1 ? "place" : "places"} left.
        </Notice>
      ) : null}

      {actionData && (
        <Notice tone={actionData.ok ? "good" : "stop"}>
          {actionData.message}
          {actionData.ok && actionData.ticketCode && (
            <>
              {" "}
              Your reference is{" "}
              <strong className="font-mono tracking-widest">{actionData.ticketCode}</strong>.
            </>
          )}
        </Notice>
      )}

      {!cancelled && !closed && types.length > 0 && !(actionData?.ok) && (
        <>
          {anyPaid && !canTakeCards ? (
            <Notice tone="quiet">
              This club isn't set up to take cards online yet. Get in touch with them directly
              to book a place.
            </Notice>
          ) : (
            <Form method="post" className="mt-10 space-y-6">
              <fieldset>
                <legend className="text-lg font-semibold">Tickets</legend>
                <div className="mt-3 space-y-3">
                  {types.map((t) => (
                    <label key={t.id} className="flex items-center justify-between gap-4">
                      <span>
                        <span className="font-medium">{t.name}</span>
                        {t.seatsEach > 1 && (
                          <span className="ml-2 text-sm opacity-60">{t.seatsEach} places</span>
                        )}
                        {t.description && (
                          <span className="block text-sm opacity-60">{t.description}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="tabular-nums">
                          {t.priceCents === 0 ? "Free" : money(t.priceCents)}
                        </span>
                        <input
                          type="number"
                          name={`qty_${t.id}`}
                          min="0"
                          max={t.maxPerOrder}
                          defaultValue="0"
                          inputMode="numeric"
                          aria-label={`How many ${t.name}`}
                          className="w-16 rounded-lg border px-2 py-1.5 text-center"
                          style={{ borderColor: "color-mix(in oklab, currentColor 25%, transparent)" }}
                        />
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your name" name="name">
                  <Input id="name" name="name" required autoComplete="name" />
                </Field>
                <Field label="Email" name="email">
                  <Input id="email" name="email" type="email" required autoComplete="email" />
                </Field>
                <Field label="Phone" name="phone" hint="Optional">
                  <Input id="phone" name="phone" autoComplete="tel" />
                </Field>
                {event.allowGuests && (
                  <Field label="Bringing anyone?" name="guestNames" hint="Names, so the club can put out badges">
                    <Input id="guestNames" name="guestNames" />
                  </Field>
                )}
              </div>

              {questions.map((q) => (
                <Field key={q.id} label={q.label} name={`q_${q.id}`}>
                  {q.kind === "choice" ? (
                    <select
                      id={`q_${q.id}`}
                      name={`q_${q.id}`}
                      required={q.required}
                      className="w-full rounded-lg border px-3 py-2"
                      style={{ borderColor: "color-mix(in oklab, currentColor 25%, transparent)" }}
                    >
                      <option value="">Choose…</option>
                      {q.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : q.kind === "checkbox" ? (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" id={`q_${q.id}`} name={`q_${q.id}`} value="yes" />
                      <span className="text-sm opacity-75">Yes</span>
                    </label>
                  ) : (
                    <Textarea id={`q_${q.id}`} name={`q_${q.id}`} rows={2} required={q.required} />
                  )}
                </Field>
              ))}

              {anyPaid && (
                <label className="flex items-start gap-2 text-sm opacity-80">
                  <input type="checkbox" name="coverFee" defaultChecked={coverFeeDefault} className="mt-1" />
                  <span>
                    Add the card processing fee so the club receives the full amount.
                  </span>
                </label>
              )}

              <Button type="submit" disabled={busy}>
                {full
                  ? "Join the waiting list"
                  : cheapest === 0 && !anyPaid
                    ? "Book my place"
                    : "Continue to payment"}
              </Button>

              {anyPaid && (
                <p className="text-sm opacity-60">
                  Payment is taken by {loaderData.club.name}'s own card account. Sodalitas takes{" "}
                  {feeSummary.charAt(0).toLowerCase() + feeSummary.slice(1)}
                </p>
              )}
              {event.refundPolicy && (
                <p className="text-sm opacity-60">
                  <strong className="font-medium">Refunds:</strong> {event.refundPolicy}
                </p>
              )}
            </Form>
          )}
        </>
      )}

      {!cancelled && !closed && types.length === 0 && (
        <Notice tone="quiet">
          Registration for this one isn't open yet. Check back, or ask the club.
        </Notice>
      )}
    </article>
  );
}

function Notice({ tone, children }: { tone: "good" | "quiet" | "stop"; children: React.ReactNode }) {
  const style =
    tone === "good"
      ? "border-l-4 border-current/40 bg-current/5"
      : tone === "stop"
        ? "border-l-4 border-current/60 bg-current/10"
        : "border-l-4 border-current/20 bg-current/5";
  return <p className={`mt-8 rounded-r-lg px-4 py-3 ${style}`}>{children}</p>;
}
