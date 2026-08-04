/**
 * payments.ts — online payment, from a club linking Stripe to a paid invoice.
 *
 * The rule this file exists to enforce: **a webhook is the only thing that
 * moves money in the ledger.** Nothing marks an invoice paid because the payer
 * came back to a success page — a success page is a redirect anyone can type,
 * and treating it as proof of payment means a club's arrears report can be
 * cleared by a stranger with a URL. The redirect only says "we're expecting
 * something"; the signed webhook says it happened.
 */

import type { TenantDb, GlobalDb } from "../scope";
import { newId } from "@domain/ids";
import { breakdown, formatCents } from "@domain/fees";
import {
  createCheckoutSession,
  accountStatus,
  paymentsConfigured,
  StripeNotConfigured,
  type StripeEnv,
  type StripeEvent,
} from "@payments/stripe";
import { recordPayment, type InvoiceRow } from "./dues";
import { logInteraction } from "./interactions";
import { confirmPaid } from "./events";

export interface PaymentSettingsRow {
  id: string;
  club_id: string;
  stripe_account_id: string | null;
  charges_enabled: number;
  currency: string;
  dues_online: number;
  donations_enabled: number;
  donation_blurb: string | null;
  suggested_amounts: string | null;
  cover_fee_default: number;
  connected_at: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

/** What the rest of the app asks about: can this club take money right now? */
export interface PaymentCapability {
  /** The deployment has a Stripe key at all. */
  platformReady: boolean;
  /** This club has linked an account that Stripe says can take charges. */
  clubReady: boolean;
  duesOnline: boolean;
  donationsEnabled: boolean;
  currency: string;
  donationBlurb: string | null;
  suggestedAmounts: number[];
  coverFeeDefault: boolean;
  accountId: string | null;
  /** Why it isn't ready, in words a treasurer can act on. */
  blockedBecause: string | null;
}

export const DEFAULT_SUGGESTED_AMOUNTS = [2500, 5000, 10000, 25000];

/** Smallest charge Stripe will take. Below this, the fee exceeds the gift. */
export const MIN_CHARGE_CENTS = 100;
/** A ceiling, so a mistyped amount can't become a $500,000 card charge. */
export const MAX_CHARGE_CENTS = 50_000_00;

export async function getSettings(
  db: TenantDb,
  clubId: string,
): Promise<PaymentSettingsRow | null> {
  return db.first<PaymentSettingsRow>("payment_settings", {
    where: "club_id = ?",
    params: [clubId],
  });
}

/**
 * What this club can do, told plainly.
 *
 * Never throws and never assumes. Every caller — the dues screen, the public
 * club page, the settings form — asks this one question and renders whatever
 * comes back, so "Stripe isn't set up" is a state the UI knows how to show
 * rather than an exception that becomes a 500.
 */
export async function capability(
  env: StripeEnv,
  db: TenantDb,
  clubId: string,
): Promise<PaymentCapability> {
  const platformReady = paymentsConfigured(env);
  const s = await getSettings(db, clubId);

  const suggested = parseAmounts(s?.suggested_amounts) ?? DEFAULT_SUGGESTED_AMOUNTS;
  const base = {
    platformReady,
    currency: s?.currency ?? "usd",
    donationBlurb: s?.donation_blurb ?? null,
    suggestedAmounts: suggested,
    coverFeeDefault: s ? s.cover_fee_default === 1 : true,
    accountId: s?.stripe_account_id ?? null,
  };

  if (!platformReady) {
    return {
      ...base,
      clubReady: false,
      duesOnline: false,
      donationsEnabled: false,
      blockedBecause: "Online payment isn't switched on for this installation yet.",
    };
  }
  if (!s?.stripe_account_id) {
    return {
      ...base,
      clubReady: false,
      duesOnline: false,
      donationsEnabled: false,
      blockedBecause: "This club hasn't linked a Stripe account yet.",
    };
  }
  if (s.charges_enabled !== 1) {
    return {
      ...base,
      clubReady: false,
      duesOnline: false,
      donationsEnabled: false,
      blockedBecause:
        "Stripe has the account but isn't accepting charges on it yet — usually a step left unfinished in Stripe's own onboarding.",
    };
  }

  return {
    ...base,
    clubReady: true,
    duesOnline: s.dues_online === 1,
    donationsEnabled: s.donations_enabled === 1,
    blockedBecause: null,
  };
}

function parseAmounts(json: string | null | undefined): number[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return null;
    const amounts = parsed
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n >= MIN_CHARGE_CENTS && n <= MAX_CHARGE_CENTS);
    return amounts.length > 0 ? amounts : null;
  } catch {
    return null;
  }
}

/** Create the settings row if it doesn't exist. Returns it either way. */
export async function ensureSettings(
  db: TenantDb,
  clubId: string,
  now: string,
): Promise<PaymentSettingsRow> {
  const existing = await getSettings(db, clubId);
  if (existing) return existing;

  const row: PaymentSettingsRow = {
    id: newId("paymentSettings"),
    club_id: clubId,
    stripe_account_id: null,
    charges_enabled: 0,
    currency: "usd",
    dues_online: 1,
    donations_enabled: 0,
    donation_blurb: null,
    suggested_amounts: JSON.stringify(DEFAULT_SUGGESTED_AMOUNTS),
    cover_fee_default: 1,
    connected_at: null,
    connected_by: null,
    created_at: now,
    updated_at: now,
  };
  await db.insert("payment_settings", { ...row });
  return row;
}

export async function saveSettings(
  db: TenantDb,
  clubId: string,
  patch: {
    duesOnline?: boolean;
    donationsEnabled?: boolean;
    donationBlurb?: string | null;
    suggestedAmounts?: number[];
    coverFeeDefault?: boolean;
  },
  now: string,
): Promise<void> {
  const s = await ensureSettings(db, clubId, now);
  const values: Record<string, unknown> = { updated_at: now };
  if (patch.duesOnline !== undefined) values.dues_online = patch.duesOnline ? 1 : 0;
  if (patch.donationsEnabled !== undefined) {
    values.donations_enabled = patch.donationsEnabled ? 1 : 0;
  }
  if (patch.donationBlurb !== undefined) values.donation_blurb = patch.donationBlurb;
  if (patch.coverFeeDefault !== undefined) {
    values.cover_fee_default = patch.coverFeeDefault ? 1 : 0;
  }
  if (patch.suggestedAmounts) {
    const clean = patch.suggestedAmounts
      .filter((n) => Number.isFinite(n) && n >= MIN_CHARGE_CENTS && n <= MAX_CHARGE_CENTS)
      .slice(0, 6);
    values.suggested_amounts = JSON.stringify(clean.length ? clean : DEFAULT_SUGGESTED_AMOUNTS);
  }
  await db.update("payment_settings", s.id, values);
}

/** Record a freshly linked Stripe account and ask Stripe what it can do. */
export async function linkAccount(
  env: StripeEnv,
  db: TenantDb,
  clubId: string,
  accountId: string,
  userId: string | null,
  now: string,
): Promise<{ chargesEnabled: boolean; pending: string[] }> {
  const s = await ensureSettings(db, clubId, now);
  let status = { chargesEnabled: false, defaultCurrency: "usd", pending: [] as string[] };
  try {
    const live = await accountStatus(env, accountId);
    status = {
      chargesEnabled: live.chargesEnabled,
      defaultCurrency: live.defaultCurrency,
      pending: live.pending,
    };
  } catch (err) {
    // Store the link anyway. The account is genuinely connected — we just
    // couldn't read its status this second, and throwing away a completed
    // OAuth round trip because of a transient API blip means the treasurer
    // does the whole dance again.
    console.error("[payments] linked account but could not read status", err);
  }

  await db.update("payment_settings", s.id, {
    stripe_account_id: accountId,
    charges_enabled: status.chargesEnabled ? 1 : 0,
    currency: status.defaultCurrency,
    connected_at: now,
    connected_by: userId,
    updated_at: now,
  });

  return { chargesEnabled: status.chargesEnabled, pending: status.pending };
}

/** Re-ask Stripe whether an account can take charges. Cheap, and often the fix. */
export async function refreshAccount(
  env: StripeEnv,
  db: TenantDb,
  clubId: string,
  now: string,
): Promise<{ chargesEnabled: boolean; pending: string[] } | null> {
  const s = await getSettings(db, clubId);
  if (!s?.stripe_account_id) return null;
  const live = await accountStatus(env, s.stripe_account_id);
  await db.update("payment_settings", s.id, {
    charges_enabled: live.chargesEnabled ? 1 : 0,
    currency: live.defaultCurrency,
    updated_at: now,
  });
  return { chargesEnabled: live.chargesEnabled, pending: live.pending };
}

export async function unlinkAccount(
  db: TenantDb,
  clubId: string,
  now: string,
): Promise<void> {
  const s = await getSettings(db, clubId);
  if (!s) return;
  await db.update("payment_settings", s.id, {
    stripe_account_id: null,
    charges_enabled: 0,
    donations_enabled: 0,
    connected_at: null,
    connected_by: null,
    updated_at: now,
  });
}

// ── Starting a checkout ───────────────────────────────────────────────────────

export interface CheckoutResult {
  url: string;
  checkoutId: string;
  chargedCents: number;
  feeCents: number;
}

/**
 * Start a checkout for one dues invoice.
 *
 * Charges the remaining balance, not the full amount — a member who paid half
 * by cheque and the rest by card should be charged the rest, and billing them
 * the whole thing again is the sort of error that ends with the treasurer
 * issuing a refund and the member not renewing.
 */
export async function checkoutInvoice(
  env: StripeEnv,
  db: TenantDb,
  input: {
    invoiceId: string;
    clubId: string;
    clubName: string;
    coverFee: boolean;
    payerEmail?: string | null;
  },
  now: string,
): Promise<CheckoutResult> {
  const cap = await capability(env, db, input.clubId);
  if (!cap.clubReady || !cap.duesOnline) {
    throw new PaymentUnavailable(cap.blockedBecause ?? "Paying dues online is switched off.");
  }

  const invoice = await db.byId<InvoiceRow>("dues_invoices", input.invoiceId);
  if (!invoice) throw new PaymentUnavailable("That invoice no longer exists.");
  if (invoice.status === "paid" || invoice.status === "waived" || invoice.status === "void") {
    throw new PaymentUnavailable(`That invoice is already settled (${invoice.status}).`);
  }

  const owed = invoice.amount_cents - invoice.paid_cents;
  if (owed < MIN_CHARGE_CENTS) {
    throw new PaymentUnavailable(
      `The balance is ${formatCents(owed, cap.currency)}, which is below the minimum a card can be charged. Record it by hand instead.`,
    );
  }

  return startCheckout(
    env,
    db,
    {
      clubId: input.clubId,
      accountId: cap.accountId!,
      currency: cap.currency,
      kind: "dues",
      amountCents: owed,
      coverFee: input.coverFee,
      personId: invoice.person_id,
      invoiceId: invoice.id,
      payerEmail: input.payerEmail ?? null,
      productName: `${input.clubName} dues`,
      description: invoice.period_label,
    },
    now,
  );
}

/** Start a donation checkout. The donor may be a complete stranger. */
export async function checkoutDonation(
  env: StripeEnv,
  db: TenantDb,
  input: {
    clubId: string;
    clubName: string;
    amountCents: number;
    coverFee: boolean;
    donorName?: string | null;
    donorEmail?: string | null;
  },
  now: string,
): Promise<CheckoutResult> {
  const cap = await capability(env, db, input.clubId);
  if (!cap.clubReady || !cap.donationsEnabled) {
    throw new PaymentUnavailable(cap.blockedBecause ?? "This club isn't taking donations online.");
  }
  if (input.amountCents < MIN_CHARGE_CENTS) {
    throw new PaymentUnavailable(
      `The smallest gift a card can take is ${formatCents(MIN_CHARGE_CENTS, cap.currency)}.`,
    );
  }
  if (input.amountCents > MAX_CHARGE_CENTS) {
    throw new PaymentUnavailable(
      `That's larger than we'll take online (${formatCents(MAX_CHARGE_CENTS, cap.currency)}). Please contact the club directly — they'd love to hear from you.`,
    );
  }

  // A donor who is already in the club's records gets their gift on their own
  // timeline. One who isn't stays a stranger — we don't manufacture a CRM
  // record for someone who gave twenty-five dollars once.
  let personId: string | null = null;
  if (input.donorEmail) {
    const match = await db.first<{ id: string }>("people", {
      columns: "id",
      where: "email_norm = ?",
      params: [input.donorEmail.trim().toLowerCase()],
    });
    personId = match?.id ?? null;
  }

  return startCheckout(
    env,
    db,
    {
      clubId: input.clubId,
      accountId: cap.accountId!,
      currency: cap.currency,
      kind: "donation",
      amountCents: input.amountCents,
      coverFee: input.coverFee,
      personId,
      invoiceId: null,
      donorName: input.donorName ?? null,
      payerEmail: input.donorEmail ?? null,
      productName: `Donation to ${input.clubName}`,
    },
    now,
  );
}

/**
 * Start a checkout for event tickets.
 *
 * The one thing on this platform that carries a fee of ours, and the only
 * `startCheckout` caller that passes `platformFeeCents`. It is computed by
 * `domain/events.ts` from what the club charged, capped, and already stored on
 * the registration before we get here — so the number the payer was shown, the
 * number on the registration and the number Stripe takes are the same number,
 * rather than three independent calculations that agree until one of them
 * doesn't.
 *
 * The fee rides on the club's own direct charge as an `application_fee_amount`
 * inside `payment_intent_data`. Anywhere else and Stripe accepts the request
 * and takes nothing.
 */
export async function checkoutTickets(
  env: StripeEnv,
  db: TenantDb,
  input: {
    clubId: string;
    clubName: string;
    registrationId: string;
    eventTitle: string;
    /** What the club charged for the tickets, before any covered card fee. */
    amountCents: number;
    coverFee: boolean;
    platformFeeCents: number;
    personId: string | null;
    payerName?: string | null;
    payerEmail?: string | null;
  },
  now: string,
): Promise<CheckoutResult> {
  const cap = await capability(env, db, input.clubId);
  if (!cap.clubReady) {
    throw new PaymentUnavailable(
      cap.blockedBecause ?? "This club can't take card payments yet. Ask them about paying another way.",
    );
  }
  if (input.amountCents < MIN_CHARGE_CENTS) {
    throw new PaymentUnavailable(
      `The smallest a card can be charged is ${formatCents(MIN_CHARGE_CENTS, cap.currency)}.`,
    );
  }
  if (input.amountCents > MAX_CHARGE_CENTS) {
    throw new PaymentUnavailable(
      `That's larger than we'll take online (${formatCents(MAX_CHARGE_CENTS, cap.currency)}). Please contact the club directly.`,
    );
  }

  return startCheckout(
    env,
    db,
    {
      clubId: input.clubId,
      accountId: cap.accountId!,
      currency: cap.currency,
      kind: "ticket",
      amountCents: input.amountCents,
      coverFee: input.coverFee,
      platformFeeCents: Math.max(0, Math.round(input.platformFeeCents)),
      personId: input.personId,
      invoiceId: null,
      donorName: input.payerName ?? null,
      payerEmail: input.payerEmail ?? null,
      productName: `${input.eventTitle} — ${input.clubName}`,
      registrationId: input.registrationId,
    },
    now,
  );
}

async function startCheckout(
  env: StripeEnv,
  db: TenantDb,
  input: {
    clubId: string;
    accountId: string;
    currency: string;
    kind: "dues" | "donation" | "ticket";
    amountCents: number;
    platformFeeCents?: number;
    /** Set for tickets: the booking this checkout is holding a seat for. */
    registrationId?: string | null;
    coverFee: boolean;
    personId: string | null;
    invoiceId: string | null;
    donorName?: string | null;
    payerEmail: string | null;
    productName: string;
    description?: string;
  },
  now: string,
): Promise<CheckoutResult> {
  const fees = breakdown(input.amountCents, input.coverFee);
  const checkoutId = newId("checkout");

  // Written before the payer leaves. An abandoned checkout is then visible as
  // an abandoned checkout rather than as nothing at all.
  await db.insert("checkout_sessions", {
    id: checkoutId,
    club_id: input.clubId,
    kind: input.kind,
    invoice_id: input.invoiceId,
    person_id: input.personId,
    donor_name: input.donorName ?? null,
    donor_email: input.payerEmail,
    amount_cents: fees.netCents,
    fee_cents: fees.feeCents,
    covered_fee: fees.covered ? 1 : 0,
    charged_cents: fees.chargedCents,
    platform_fee_cents: input.platformFeeCents ?? 0,
    stripe_session_id: null,
    stripe_account_id: input.accountId,
    status: "open",
    completed_at: null,
    created_at: now,
  });

  const session = await createCheckoutSession(env, {
    account: input.accountId,
    chargedCents: fees.chargedCents,
    currency: input.currency,
    productName: input.productName,
    description: input.description,
    customerEmail: input.payerEmail,
    successUrl: `${env.APP_URL}/pay/thanks?c=${checkoutId}`,
    cancelUrl: `${env.APP_URL}/pay/cancelled?c=${checkoutId}`,
    applicationFeeCents: input.platformFeeCents ?? 0,
    // Metadata is how the webhook finds this row again. Tenant included
    // because the event arrives with no session and no cookie — it is the only
    // thing that tells us whose ledger to write to.
    metadata: {
      sodalitas_checkout: checkoutId,
      sodalitas_tenant: db.tenantId,
      sodalitas_club: input.clubId,
      sodalitas_kind: input.kind,
    },
    reference: checkoutId,
  });

  await db.update("checkout_sessions", checkoutId, { stripe_session_id: session.id });

  return {
    url: session.url,
    checkoutId,
    chargedCents: fees.chargedCents,
    feeCents: fees.feeCents,
  };
}

export class PaymentUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentUnavailable";
  }
}

// ── Applying a webhook ────────────────────────────────────────────────────────

export interface WebhookOutcome {
  handled: boolean;
  /** Human-readable, for the ops log. Never shown to a payer. */
  note: string;
}

/**
 * Claim an event id, returning false if it has already been seen.
 *
 * `INSERT OR IGNORE` on the provider's own event id makes this one atomic
 * write instead of a read-then-write race — which matters, because Stripe
 * retries and two deliveries genuinely can land at the same instant, and
 * "check then insert" would credit a club twice for one payment.
 */
export async function claimEvent(
  global: GlobalDb,
  event: StripeEvent,
  now: string,
): Promise<boolean> {
  const res = await global.run(
    `INSERT OR IGNORE INTO webhook_events (id, provider, type, account_id, handled, received_at)
     VALUES (?, 'stripe', ?, ?, 0, ?)`,
    [event.id, event.type, event.account ?? null, now],
  );
  return (res.meta.changes ?? 0) > 0;
}

export async function markEventHandled(
  global: GlobalDb,
  eventId: string,
  error: string | null,
): Promise<void> {
  await global.run(`UPDATE webhook_events SET handled = ?, error = ? WHERE id = ?`, [
    error ? 0 : 1,
    error,
    eventId,
  ]);
}

/**
 * Apply a completed checkout to the ledger.
 *
 * Idempotent twice over: the event ledger stops a repeated delivery from ever
 * reaching here, and the `payments` table's UNIQUE (tenant_id, method,
 * external_id) stops a duplicate row even if it did. Belt and braces, because
 * the failure mode is a club's books being wrong.
 */
export async function applyCheckoutCompleted(
  db: TenantDb,
  event: StripeEvent,
  now: string,
): Promise<WebhookOutcome> {
  const session = event.data.object;
  const metadata = (session.metadata ?? {}) as Record<string, string>;
  const checkoutId = metadata.sodalitas_checkout;
  if (!checkoutId) {
    // Not ours. A club's own Stripe account may take payments from anywhere —
    // their website, an in-person terminal — and those are none of our business.
    return { handled: true, note: "no sodalitas metadata; not our checkout" };
  }

  const row = await db.byId<{
    id: string;
    club_id: string;
    kind: string;
    invoice_id: string | null;
    person_id: string | null;
    donor_name: string | null;
    donor_email: string | null;
    amount_cents: number;
    fee_cents: number;
    covered_fee: number;
    platform_fee_cents: number;
    stripe_account_id: string | null;
    status: string;
  }>("checkout_sessions", checkoutId);

  if (!row) return { handled: true, note: `checkout ${checkoutId} not found in this tenant` };
  if (row.status === "complete") return { handled: true, note: "already complete" };

  /**
   * The event must have happened on the account this checkout was created for.
   *
   * Metadata is signed by Stripe, so nobody outside can forge it — but every
   * club connected to this platform can create sessions on *their own* account
   * with whatever metadata they like. Without this check, one club could stamp
   * another club's tenant and checkout id onto a one-cent charge of their own
   * and have us mark that club's invoice paid. Binding the event's account to
   * the account we opened the checkout on closes that: a club can only ever
   * settle checkouts we created for them.
   */
  if (row.stripe_account_id && event.account && event.account !== row.stripe_account_id) {
    console.warn(
      `[payments] event ${event.id} on account ${event.account} claims checkout ${checkoutId}, which belongs to ${row.stripe_account_id}`,
    );
    return { handled: true, note: "account mismatch; ignored" };
  }

  // Trust our own stored amount, not the number in the event. They should
  // agree, and if they don't, the one we computed and wrote down before the
  // payer ever left is the one to reconcile against.
  const paymentIntent =
    typeof session.payment_intent === "string" ? session.payment_intent : null;
  const externalId = paymentIntent ?? String(session.id ?? row.id);
  const receivedOn = now.slice(0, 10);

  if (row.kind === "dues" && row.invoice_id) {
    const applied = await recordPayment(
      db,
      {
        invoiceId: row.invoice_id,
        clubId: row.club_id,
        amountCents: row.amount_cents,
        method: "stripe",
        receivedOn,
        externalId,
        feeCents: row.fee_cents,
        coveredFee: row.covered_fee === 1,
      },
      now,
      null,
    );
    if (!applied) {
      return { handled: false, note: `invoice ${row.invoice_id} vanished before payment applied` };
    }
  } else if (row.kind === "ticket") {
    /**
     * A paid seat.
     *
     * The registration is found through its own `checkout_id` rather than a
     * column on the checkout, so the link points the way it is actually used:
     * a booking knows what it's waiting on. `confirmPaid` is idempotent — it
     * returns early unless the row is still `pending` — which matters because
     * Stripe will happily deliver this event twice.
     */
    await db.insert("payments", {
      id: newId("payment"),
      club_id: row.club_id,
      person_id: row.person_id,
      invoice_id: null,
      kind: "event",
      amount_cents: row.amount_cents,
      fee_cents: row.fee_cents,
      platform_fee_cents: row.platform_fee_cents,
      covered_fee: row.covered_fee,
      method: "stripe",
      external_id: externalId,
      received_on: receivedOn,
      notes: row.donor_name ? `Tickets — ${row.donor_name}` : "Event tickets",
      created_at: now,
    });

    const registration = await db.first<{ id: string }>("event_registrations", {
      columns: "id",
      where: "checkout_id = ?",
      params: [row.id],
    });
    if (registration) {
      await confirmPaid(db, registration.id, now);
    } else {
      // The money arrived and we can't find the seat it was for. Recorded in
      // the ledger regardless — the club is not out of pocket — but this needs
      // a human, so say so rather than returning a quiet success.
      console.error(`[payments] ticket checkout ${row.id} has no registration`);
    }
  } else {
    await db.insert("payments", {
      id: newId("payment"),
      club_id: row.club_id,
      person_id: row.person_id,
      invoice_id: null,
      kind: "donation",
      amount_cents: row.amount_cents,
      fee_cents: row.fee_cents,
      covered_fee: row.covered_fee,
      method: "stripe",
      external_id: externalId,
      received_on: receivedOn,
      notes: row.donor_name ? `Donation from ${row.donor_name}` : "Online donation",
      created_at: now,
    });

    // A gift from someone already in the club's records belongs on their
    // timeline. A stranger's doesn't get one, because there's nobody to put it
    // against and inventing a contact record from a card payment is not ours
    // to do.
    if (row.person_id) {
      await logInteraction(
        db,
        {
          clubId: row.club_id,
          personId: row.person_id,
          kind: "gift",
          subject: `Donation — ${formatCents(row.amount_cents)}`,
          refType: "checkout_session",
          refId: row.id,
          actorUserId: null,
        },
        now,
      );
    }
  }

  await db.update("checkout_sessions", row.id, { status: "complete", completed_at: now });
  return { handled: true, note: `${row.kind} ${formatCents(row.amount_cents)} applied` };
}

/** Mark an expired checkout expired, so it stops looking like it's in flight. */
export async function applyCheckoutExpired(
  db: TenantDb,
  event: StripeEvent,
): Promise<WebhookOutcome> {
  const metadata = (event.data.object.metadata ?? {}) as Record<string, string>;
  const checkoutId = metadata.sodalitas_checkout;
  if (!checkoutId) return { handled: true, note: "not our checkout" };

  const row = await db.byId<{ stripe_account_id: string | null; status: string }>(
    "checkout_sessions",
    checkoutId,
    { columns: "stripe_account_id, status" },
  );
  if (!row) return { handled: true, note: "not found" };
  // Same account binding as the completion path — see applyCheckoutCompleted.
  if (row.stripe_account_id && event.account && event.account !== row.stripe_account_id) {
    return { handled: true, note: "account mismatch; ignored" };
  }
  // A completed checkout is not expired by a late expiry event.
  if (row.status === "complete") return { handled: true, note: "already complete" };

  await db.update("checkout_sessions", checkoutId, { status: "expired" });
  return { handled: true, note: "marked expired" };
}

/**
 * Reverse a refunded payment.
 *
 * Recorded as a negative payment rather than by deleting the original, and the
 * invoice returns to whatever it honestly is now. Deleting the row would leave
 * the club's history claiming a payment that was given back, which is the sort
 * of quiet inaccuracy that makes a treasurer stop trusting every other number
 * on the page.
 */
export async function applyChargeRefunded(
  db: TenantDb,
  event: StripeEvent,
  now: string,
): Promise<WebhookOutcome> {
  const charge = event.data.object;
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!intent) return { handled: true, note: "refund with no payment intent" };

  const original = await db.first<{
    id: string;
    club_id: string | null;
    person_id: string | null;
    invoice_id: string | null;
    amount_cents: number;
  }>("payments", {
    where: "method = 'stripe' AND external_id = ?",
    params: [intent],
  });
  if (!original) return { handled: true, note: "refund for a payment we never recorded" };

  // Account binding again: without it, any connected club could refund a charge
  // on their own account while claiming another club's tenant, and we'd reverse
  // a payment that was never theirs.
  if (event.account && original.club_id) {
    const settings = await getSettings(db, original.club_id);
    if (settings?.stripe_account_id && settings.stripe_account_id !== event.account) {
      console.warn(`[payments] refund ${event.id} from a foreign account; ignored`);
      return { handled: true, note: "account mismatch; ignored" };
    }
  }

  const refunded = Number(charge.amount_refunded ?? 0);
  if (refunded <= 0) return { handled: true, note: "no refunded amount" };

  const already = await db.first<{ id: string }>("payments", {
    columns: "id",
    where: "method = 'stripe' AND external_id = ?",
    params: [`${intent}:refund`],
  });
  if (already) return { handled: true, note: "refund already recorded" };

  await db.insert("payments", {
    id: newId("payment"),
    club_id: original.club_id,
    person_id: original.person_id,
    invoice_id: original.invoice_id,
    kind: "refund",
    amount_cents: -refunded,
    fee_cents: 0,
    covered_fee: 0,
    method: "stripe",
    external_id: `${intent}:refund`,
    received_on: now.slice(0, 10),
    notes: "Refunded in Stripe",
    created_at: now,
  });

  if (original.invoice_id) {
    const invoice = await db.byId<InvoiceRow>("dues_invoices", original.invoice_id);
    if (invoice) {
      const paid = Math.max(0, invoice.paid_cents - refunded);
      await db.update("dues_invoices", invoice.id, {
        paid_cents: paid,
        status: paid >= invoice.amount_cents ? "paid" : paid > 0 ? "partial" : "open",
        updated_at: now,
      });
    }
  }

  return { handled: true, note: `refund of ${formatCents(refunded)} recorded` };
}

/** Route one verified event. Unknown types are acknowledged, not errors. */
export async function applyEvent(
  db: TenantDb,
  event: StripeEvent,
  now: string,
): Promise<WebhookOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
    // A bank debit clears days later. Same handler: the money arrived, and
    // whether it took two seconds or four days changes nothing in the ledger.
    case "checkout.session.async_payment_succeeded":
      return applyCheckoutCompleted(db, event, now);
    case "checkout.session.expired":
      return applyCheckoutExpired(db, event);
    case "charge.refunded":
      return applyChargeRefunded(db, event, now);
    default:
      return { handled: true, note: `ignored ${event.type}` };
  }
}

/**
 * The tenant an event belongs to, from the metadata we put on it.
 *
 * This is the whole reason `payment_intent_data.metadata` is set alongside the
 * session's own: a `charge.refunded` event carries the charge, and a charge
 * inherits its metadata from the intent that created it. Without that second
 * stamp, a refund would arrive with no way to tell whose ledger it belongs to.
 *
 * Null is a normal answer, not a failure — a club's Stripe account takes
 * payments we know nothing about, and those are none of our business.
 */
export function tenantOf(event: StripeEvent): string | null {
  const metadata = (event.data.object.metadata ?? {}) as Record<string, string>;
  return metadata.sodalitas_tenant ?? null;
}

export { StripeNotConfigured };
