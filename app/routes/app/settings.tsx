import { Form, Link } from "react-router";
import type { Route } from "./+types/settings";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext, requireNotDemo } from "@worker/context";
import { ROLES, rolesForScope } from "@domain/roles";
import { listPeople, displayName } from "@db/services/people";
import { newId } from "@domain/ids";
import { normalizeEmail, looksLikeEmail, issueToken } from "@worker/auth/crypto";
import {
  capability, saveSettings, refreshAccount, unlinkAccount, getSettings,
} from "@db/services/payments";
import { connectConfigured, revokeConnect } from "@payments/stripe";
import { teamInvite } from "@emails/templates";
import { sendEmail } from "@emails/send";
import { parseDollars } from "@domain/fees";
import {
  PageHeader, Card, Table, Th, Td, Chip, Button, ButtonLink, Field, Input, Select, Textarea,
  formatDate,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Settings");
}

/**
 * The Rotary year runs July to June, and offices turn over with it. Defaulting
 * an end date to the coming 30 June is the difference between access that
 * expires on its own and a club where last year's treasurer still has the keys
 * in November.
 */
function endOfRotaryYear(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return `${month >= 7 ? year + 1 : year}-06-30`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("settings.read");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string; slug: string }>("clubs", {
    columns: "id, name, slug",
  });
  if (!club) {
    return {
      club: null, assignments: [], people: [], canAssign: false, defaultEnd: "",
      payments: null, canManagePayments: false, connectAvailable: false, paymentsNotice: null,
    };
  }

  const [assignments, page, payments] = await Promise.all([
    db.raw<{
      id: string; role_key: string; starts_on: string | null; ends_on: string | null;
      first_name: string | null; last_name: string | null; email: string;
    }>(
      `SELECT r.id, r.role_key, r.starts_on, r.ends_on,
              p.first_name, p.last_name, u.email
         FROM role_assignments r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN people p ON p.id = r.person_id AND p.tenant_id = {{tenant}}
        WHERE r.tenant_id = {{tenant}} AND r.scope_type = 'club' AND r.scope_id = ?
        ORDER BY r.created_at`,
      [club.id],
    ),
    listPeople(db, { role: "member", limit: 200 }),
    capability(ctx.env, db, club.id),
  ]);

  const url = new URL(request.url);

  return {
    club,
    today: ctx.today,
    payments,
    canManagePayments: ctx.can("payments.settings", club.id),
    connectAvailable: connectConfigured(ctx.env),
    // Set by the Connect round trip, which lands back here as a redirect.
    paymentsNotice: url.searchParams.get("payments"),
    defaultEnd: endOfRotaryYear(ctx.today),
    canAssign: ctx.can("roles.assign", club.id),
    people: page.people.map((p) => ({ id: p.id, name: displayName(p), email: p.email })),
    assignments: assignments.map((a) => ({
      id: a.id,
      roleKey: a.role_key,
      roleLabel: ROLES[a.role_key]?.label ?? a.role_key,
      blurb: ROLES[a.role_key]?.blurb ?? "",
      name: a.first_name ? `${a.first_name} ${a.last_name}` : a.email,
      email: a.email,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
      expired: Boolean(a.ends_on && a.ends_on < ctx.today),
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Payment settings are a different office from assigning roles — a treasurer
  // should be able to switch donations on without also being able to hand out
  // the keys to the club. So the capability check follows the intent rather
  // than guarding the whole action.
  if (intent === "payments") {
    ctx.require("payments.settings", club.id);
    requireNotDemo(ctx, "Connecting a payment account");
    const amounts = String(form.get("suggestedAmounts") ?? "")
      .split(",")
      .map((s) => parseDollars(s))
      .filter((n): n is number => n !== null);

    await saveSettings(
      db,
      club.id,
      {
        duesOnline: form.get("duesOnline") === "on",
        donationsEnabled: form.get("donationsEnabled") === "on",
        donationBlurb: String(form.get("donationBlurb") ?? "").trim() || null,
        coverFeeDefault: form.get("coverFeeDefault") === "on",
        ...(amounts.length > 0 ? { suggestedAmounts: amounts } : {}),
      },
      ctx.now,
    );
    return { ok: true, savedPayments: true };
  }

  if (intent === "payments-refresh") {
    ctx.require("payments.settings", club.id);
    requireNotDemo(ctx, "Connecting a payment account");
    try {
      const result = await refreshAccount(ctx.env, db, club.id, ctx.now);
      if (!result) return { error: "No Stripe account is linked to this club." };
      return { ok: true, refreshed: result.chargesEnabled };
    } catch (err) {
      // Stripe's own message is the actionable one here.
      return { error: err instanceof Error ? err.message : "Stripe didn't answer." };
    }
  }

  if (intent === "payments-unlink") {
    ctx.require("payments.settings", club.id);
    requireNotDemo(ctx, "Connecting a payment account");
    const settings = await getSettings(db, club.id);
    // Forget it on our side first. If Stripe's deauthorize call fails we must
    // still stop using an account the club has told us to stop using.
    await unlinkAccount(db, club.id, ctx.now);
    if (settings?.stripe_account_id && connectConfigured(ctx.env)) {
      try {
        await revokeConnect(ctx.env, settings.stripe_account_id);
      } catch (err) {
        console.error("[stripe] deauthorize failed; already unlinked locally", err);
      }
    }
    return { ok: true, unlinked: true };
  }

  ctx.require("roles.assign", club.id);

  if (intent === "remove") {
    await db.remove("role_assignments", String(form.get("assignmentId") ?? ""), ctx.now);
    return { ok: true };
  }

  const email = String(form.get("email") ?? "").trim();
  const roleKey = String(form.get("roleKey") ?? "");
  if (!looksLikeEmail(email)) return { error: "We need an email address to send the invitation to." };
  if (!ROLES[roleKey]) return { error: "Pick an office." };

  // The one action here that mails a stranger.
  requireNotDemo(ctx, "Inviting an officer by email");

  const emailNorm = normalizeEmail(email);
  const personId = String(form.get("personId") ?? "") || null;

  // Reuse the login if this address already has one — somebody who serves two
  // clubs should have one account, not two.
  let userId: string;
  const existing = await db.unsafeDb
    .prepare(`SELECT id FROM users WHERE email_norm = ?`)
    .bind(emailNorm)
    .first<{ id: string }>();

  if (existing) {
    userId = existing.id;
  } else {
    userId = newId("user");
    await db.unsafeDb
      .prepare(
        `INSERT INTO users (id, email, email_norm, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(userId, email, emailNorm, ctx.now, ctx.now)
      .run();
  }

  await db.unsafeDb
    .prepare(
      `INSERT INTO tenant_users (tenant_id, user_id, status, created_at)
       VALUES (?, ?, 'active', ?)
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    )
    .bind(ctx.tenantId, userId, ctx.now)
    .run();

  await db.insert("role_assignments", {
    id: newId("role"),
    user_id: userId,
    person_id: personId,
    role_key: roleKey,
    scope_type: "club",
    scope_id: club.id,
    extra_caps: "",
    starts_on: String(form.get("startsOn") ?? "") || null,
    ends_on: String(form.get("endsOn") ?? "") || null,
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  // The token is stored only as a hash — a leaked backup is not a leaked
  // mailbox. The plain token exists just long enough to go into the email.
  const { token, hash } = await issueToken();
  await db.insert("invites", {
    id: newId("invite"),
    club_id: club.id,
    email_norm: emailNorm,
    person_id: personId,
    role_key: roleKey,
    token_hash: hash,
    invited_by: ctx.user?.id ?? null,
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    created_at: ctx.now,
  });

  const clubRow = await db.byId<{ name: string }>("clubs", club.id, { columns: "name" });
  const template = teamInvite({
    inviterName: ctx.user?.displayName ?? "Someone at the club",
    clubName: clubRow?.name ?? "the club",
    roleLabel: ROLES[roleKey]?.label ?? roleKey,
    url: `${ctx.env.APP_URL}/invite/${token}`,
  });

  // Transactional: an invitation somebody's club sent them on purpose is not
  // marketing, and it must reach an address that opted out of the newsletter.
  const sent = await sendEmail(
    ctx.env,
    db,
    {
      to: email,
      subject: template.subject,
      text: template.text,
      clubId: club.id,
      personId,
      templateKey: "teamInvite",
      transactional: true,
    },
    ctx.now,
  );

  // Report what actually happened. With no mail provider the invitation is
  // written to the log rather than sent, and telling the president "invited"
  // when nothing left the building is how somebody waits a week for an email
  // that was never going to arrive.
  return { ok: true, invited: email, delivery: sent.status };
}

/** What the Connect round trip told us, in words rather than a query string. */
const CONNECT_NOTICES: Record<string, { tone: "good" | "warn"; text: string }> = {
  linked: { tone: "good", text: "Stripe is linked and ready to take payments." },
  pending: {
    tone: "warn",
    text:
      "Stripe is linked, but it isn't accepting charges yet — there's usually a step left " +
      "unfinished in Stripe's own onboarding. Finish it there, then press Check again.",
  },
  cancelled: { tone: "warn", text: "No harm done — nothing was linked." },
  expired: { tone: "warn", text: "That took a while and the link expired. Start again when you're ready." },
  incomplete: { tone: "warn", text: "Stripe sent us back without everything we needed. Try once more." },
  wrong_account: {
    tone: "warn",
    text: "You finished that in a different Sodalitas account from the one that started it. Sign in as the same person and try again.",
  },
  not_allowed: { tone: "warn", text: "Your office doesn't include setting up payments." },
  failed: { tone: "warn", text: "Stripe declined to finish linking. Nothing was changed." },
};

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const {
    club, assignments, people, canAssign, defaultEnd,
    payments, canManagePayments, connectAvailable, paymentsNotice,
  } = loaderData;

  if (!club) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <PageHeader title="Settings" />
        <p className="text-ink-600 dark:text-ink-400">This account isn't attached to a club.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Settings"
        subtitle={`${club.name} — who holds which office, and until when.`}
      />

      <Card className="mb-8">
        <h2 className="font-medium text-ink-900 dark:text-ink-100">Your public page</h2>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
          Anyone can find the club here. It shows meetings, projects, officers and a form for
          visitors — never your roster.
        </p>
        <Link
          to={`/club/${club.slug}`}
          className="mt-2 inline-block text-brand-600 hover:underline"
        >
          /club/{club.slug}
        </Link>
      </Card>

      {payments && canManagePayments && (
        <Card className="mb-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Taking money online</h2>
          {/* The sentence a treasurer needs before they'll link anything. */}
          <p className="mt-1 text-sm text-pretty text-ink-600 dark:text-ink-400">
            The club connects its own Stripe account, and dues and donations go straight into the
            club's bank. We never hold your money and we take no cut of it — Sodalitas is paid for
            by the subscription, not by a slice of your dues.
          </p>

          {paymentsNotice && CONNECT_NOTICES[paymentsNotice] && (
            <p
              className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                CONNECT_NOTICES[paymentsNotice]!.tone === "good"
                  ? "bg-steady-500/12 text-steady-500"
                  : "bg-watch-500/12 text-watch-500"
              }`}
            >
              {CONNECT_NOTICES[paymentsNotice]!.text}
            </p>
          )}

          {!payments.platformReady ? (
            <p className="mt-4 rounded-lg bg-ink-500/8 px-4 py-3 text-sm text-ink-600 dark:text-ink-400">
              Online payment isn't switched on for this installation yet. Everything else about
              dues works without it — billing, cheques, cash, waivers and the arrears report are
              all unaffected.
            </p>
          ) : !payments.accountId ? (
            <div className="mt-4">
              {connectAvailable ? (
                <ButtonLink to={`/api/stripe/connect/start?club=${club.id}`} external>
                  Link the club's Stripe account
                </ButtonLink>
              ) : (
                <p className="text-sm text-ink-600 dark:text-ink-400">
                  Linking isn't available on this installation yet.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Chip tone={payments.clubReady ? "steady" : "watch"}>
                  {payments.clubReady ? "Ready" : "Not taking charges yet"}
                </Chip>
                <code className="text-xs text-ink-500">{payments.accountId}</code>
                <Form method="post">
                  <input type="hidden" name="intent" value="payments-refresh" />
                  <Button type="submit" variant="quiet">
                    Check again
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="payments-unlink" />
                  <Button type="submit" variant="quiet">
                    Unlink
                  </Button>
                </Form>
              </div>
              {payments.blockedBecause && (
                <p className="mt-3 text-sm text-watch-500">{payments.blockedBecause}</p>
              )}

              <Form method="post" className="mt-6 space-y-4">
                <input type="hidden" name="intent" value="payments" />
                <label className="flex items-start gap-2.5 text-sm text-ink-700 dark:text-ink-300">
                  <input
                    type="checkbox"
                    name="duesOnline"
                    defaultChecked={payments.duesOnline}
                    className="mt-0.5 rounded border-ink-300"
                  />
                  <span>Let members pay their dues by card</span>
                </label>
                <label className="flex items-start gap-2.5 text-sm text-ink-700 dark:text-ink-300">
                  <input
                    type="checkbox"
                    name="donationsEnabled"
                    defaultChecked={payments.donationsEnabled}
                    className="mt-0.5 rounded border-ink-300"
                  />
                  <span>
                    Show a Donate button on the club's public page
                    <span className="block text-xs text-ink-500">
                      Visible to anyone who finds the page. Gifts land in the club's Stripe account.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-sm text-ink-700 dark:text-ink-300">
                  <input
                    type="checkbox"
                    name="coverFeeDefault"
                    defaultChecked={payments.coverFeeDefault}
                    className="mt-0.5 rounded border-ink-300"
                  />
                  <span>
                    Offer to let payers cover the card fee, ticked by default
                    <span className="block text-xs text-ink-500">
                      Most people say yes when asked plainly. Left unticked it's a quiet 3% off
                      everything the club raises.
                    </span>
                  </span>
                </label>

                <Field
                  label="Suggested amounts"
                  name="suggestedAmounts"
                  hint="Comma separated, in dollars. Suggestions only — a donor can type anything."
                >
                  <Input
                    id="suggestedAmounts"
                    name="suggestedAmounts"
                    defaultValue={payments.suggestedAmounts
                      .map((c) => (c / 100).toFixed(0))
                      .join(", ")}
                  />
                </Field>

                <Field
                  label="What the money is for"
                  name="donationBlurb"
                  hint="One or two sentences on the donation form. Concrete beats worthy."
                >
                  <Textarea
                    id="donationBlurb"
                    name="donationBlurb"
                    rows={2}
                    defaultValue={payments.donationBlurb ?? ""}
                    placeholder="Every gift goes to the shelter meals programme and the two scholarships we fund each June."
                  />
                </Field>

                {actionData && "savedPayments" in actionData && actionData.savedPayments && (
                  <p className="text-sm text-steady-500">Saved.</p>
                )}
                <Button type="submit">Save payment settings</Button>
              </Form>
            </>
          )}
        </Card>
      )}

      {/* ── Officers ── */}
      <h2 className="pb-3 font-medium text-ink-900 dark:text-ink-100">Officers</h2>
      <p className="pb-4 text-sm text-pretty text-ink-600 dark:text-ink-400">
        Access ends on the date it says. The Rotary year runs to 30 June, so an office set to
        expire then simply stops working at the handover — nobody has to remember to take the
        keys back.
      </p>

      {assignments.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Who</Th>
              <Th>Office</Th>
              <Th>Until</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <Td>
                  <span className="text-ink-900 dark:text-ink-100">{a.name}</span>
                  <div className="text-xs text-ink-500">{a.email}</div>
                </Td>
                <Td>
                  <span className="text-ink-800 dark:text-ink-200">{a.roleLabel}</span>
                  <div className="text-xs text-pretty text-ink-500">{a.blurb}</div>
                </Td>
                <Td>
                  {a.endsOn ? (
                    <span className={a.expired ? "text-ink-500 line-through" : "text-ink-700 dark:text-ink-300"}>
                      {formatDate(a.endsOn)}
                    </span>
                  ) : (
                    <span className="text-ink-500">open-ended</span>
                  )}
                  {a.expired && (
                    <div className="mt-0.5">
                      <Chip tone="neutral">term ended</Chip>
                    </div>
                  )}
                </Td>
                <Td>
                  {canAssign && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <Button type="submit" variant="quiet">
                        Remove
                      </Button>
                    </Form>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {canAssign && (
        <Card className="mt-6">
          <h3 className="font-medium text-ink-900 dark:text-ink-100">Give somebody an office</h3>
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="assign" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" name="email" hint="We'll send them a link — no password to make up.">
                <Input id="email" name="email" type="email" required />
              </Field>
              <Field label="Office" name="roleKey">
                <Select id="roleKey" name="roleKey" defaultValue="club_secretary">
                  {rolesForScope("club").map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Which member is this?" name="personId" hint="Optional — links the office to their record.">
                <Select id="personId" name="personId" defaultValue="">
                  <option value="">Not on the roster yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Until"
                name="endsOn"
                hint="Defaults to the end of the Rotary year."
              >
                <Input id="endsOn" name="endsOn" type="date" defaultValue={defaultEnd} />
              </Field>
            </div>

            {actionData && "error" in actionData && actionData.error && (
              <p className="text-sm text-risk-500">{actionData.error}</p>
            )}
            {actionData && "invited" in actionData && actionData.invited && (
              <p className="text-sm text-steady-500">
                {actionData.delivery === "sent" ? (
                  <>Invited {actionData.invited}. They'll get a link to sign in.</>
                ) : (
                  <>
                    {actionData.invited} now holds the office, but no email went out — this
                    installation has no mail provider configured, so the invitation was written
                    to the log instead. They can still sign in with a link from the login page.
                  </>
                )}
              </p>
            )}

            <Button type="submit">Send the invitation</Button>
          </Form>
        </Card>
      )}
    </div>
  );
}
