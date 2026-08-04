/**
 * stripe.ts — a small Stripe client for Workers.
 *
 * No SDK. The official Node library pulls in a lot of machinery we don't need
 * and historically fought the Workers runtime; Stripe's API is form-encoded
 * HTTP, `fetch` speaks that natively, and the six calls this product makes fit
 * on one screen. The parts worth being careful about — signature verification,
 * idempotency, Connect account routing — are careful here rather than trusted
 * to a dependency we can't read.
 *
 * ## Connect, and whose money this is
 *
 * Every charge is created **directly on the club's own connected account** via
 * the `Stripe-Account` header. The money never touches a Sodalitas balance, and
 * we take no application fee. A club's dues land in the club's bank account, in
 * the club's Stripe dashboard, under the club's own tax identity. That is the
 * only arrangement a volunteer treasurer should accept from a vendor, and it
 * keeps us out of the business of holding charitable funds.
 *
 * ## Running dark
 *
 * Without STRIPE_SECRET_KEY nothing here is called and the product simply
 * doesn't offer online payment — invoices are still billed, still tracked, and
 * still marked paid by hand. Payment is a convenience layered on top of a dues
 * system that works without it, never a dependency of it.
 */

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Connect OAuth client id (ca_…). Without it, clubs can't link an account. */
  STRIPE_CONNECT_CLIENT_ID?: string;
  APP_URL: string;
}

const API = "https://api.stripe.com";
const API_VERSION = "2024-06-20";
const TIMEOUT_MS = 20_000;

/** True when charges can be created at all. */
export function paymentsConfigured(env: StripeEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** True when a club can link its own Stripe account through Connect. */
export function connectConfigured(env: StripeEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_CONNECT_CLIENT_ID);
}

/** True when webhook deliveries can be trusted. */
export function webhooksConfigured(env: StripeEnv): boolean {
  return Boolean(env.STRIPE_WEBHOOK_SECRET);
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly declineCode?: string,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

export class StripeNotConfigured extends Error {
  constructor() {
    super("Online payment isn't set up for this club yet.");
    this.name = "StripeNotConfigured";
  }
}

/**
 * Flatten a nested object into Stripe's bracket form.
 *
 *   { line_items: [{ price_data: { unit_amount: 500 } }] }
 *   → line_items[0][price_data][unit_amount]=500
 *
 * Undefined and null are dropped rather than sent as the strings "undefined"
 * and "null", which Stripe would cheerfully store as metadata.
 */
export function encodeForm(input: Record<string, unknown>, prefix = ""): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          parts.push(...encodeForm(item as Record<string, unknown>, `${name}[${i}]`));
        } else if (item !== undefined && item !== null) {
          parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === "object") {
      parts.push(...encodeForm(value as Record<string, unknown>, name));
    } else if (typeof value === "boolean") {
      parts.push(`${encodeURIComponent(name)}=${value ? "true" : "false"}`);
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

export interface CallOptions {
  /** Act on a connected account (acct_…). */
  account?: string | null;
  /**
   * Idempotency key. Stripe holds the first response for 24 hours and replays
   * it, so a retried checkout doesn't create a second one. Every write below
   * passes one; a write without one is a bug waiting for a flaky network.
   */
  idempotencyKey?: string;
  method?: "GET" | "POST";
}

export async function stripeCall<T = Record<string, unknown>>(
  env: StripeEnv,
  path: string,
  params: Record<string, unknown> = {},
  opts: CallOptions = {},
): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new StripeNotConfigured();
  const method = opts.method ?? "POST";
  const body = encodeForm(params).join("&");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    "Stripe-Version": API_VERSION,
  };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (opts.account) headers["Stripe-Account"] = opts.account;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;

  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Fall through — a non-JSON body from Stripe means something unusual.
  }

  if (!res.ok) {
    const err = (json?.error ?? {}) as Record<string, unknown>;
    throw new StripeError(
      // Stripe's own message is nearly always the actionable one: "your account
      // cannot currently make live charges", "amount must be at least 50 cents".
      // Replacing it with "payment failed" throws away the answer.
      typeof err.message === "string" ? err.message : `Stripe ${res.status}`,
      res.status,
      typeof err.code === "string" ? err.code : undefined,
      typeof err.decline_code === "string" ? err.decline_code : undefined,
    );
  }

  return (json ?? {}) as T;
}

// ── Checkout ──────────────────────────────────────────────────────────────────

export interface CheckoutInput {
  /** The club's connected account. */
  account: string;
  /** What the card is charged, in cents. Already grossed up if the fee is covered. */
  chargedCents: number;
  currency: string;
  /** Shown on the Stripe page and on the card statement line. */
  productName: string;
  description?: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Comes back verbatim in the webhook. This is how we find our own row again. */
  metadata: Record<string, string>;
  /** Our checkout_sessions id, used as the idempotency key. */
  reference: string;
  /**
   * Our platform fee, in cents. Omitted or zero means we take nothing, which
   * is the case for every dues invoice and every donation in the product —
   * see domain/pricing.ts. Only paid event tickets ever set this.
   *
   * On a direct charge this must be `application_fee_amount` inside
   * `payment_intent_data`, not at the top level: the charge belongs to the
   * connected account, and the fee is a property of the payment intent that
   * account creates. Put it at the top level and Stripe accepts the request
   * and silently takes nothing.
   */
  applicationFeeCents?: number;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export async function createCheckoutSession(
  env: StripeEnv,
  input: CheckoutInput,
): Promise<CheckoutSession> {
  const session = await stripeCall<{ id: string; url: string | null }>(
    env,
    "/v1/checkout/sessions",
    {
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail || undefined,
      // Stripe requires an email for a receipt; asking for it also gives the
      // club a way to thank a donor they've never met.
      customer_creation: input.customerEmail ? undefined : "always",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency,
            unit_amount: input.chargedCents,
            product_data: {
              name: input.productName,
              description: input.description || undefined,
            },
          },
        },
      ],
      // Metadata on both the session and the resulting payment intent. The
      // session is what the webhook carries; the intent is what a treasurer
      // sees in the Stripe dashboard, and "invoice iv_…" there saves an hour of
      // cross-referencing later.
      metadata: input.metadata,
      payment_intent_data: {
        metadata: input.metadata,
        // Only present when there is one. An `application_fee_amount: 0` is a
        // different thing to Stripe than no fee at all, and sending the zero
        // on every dues invoice would be a standing claim on money we have
        // said we don't take.
        ...(input.applicationFeeCents && input.applicationFeeCents > 0
          ? { application_fee_amount: input.applicationFeeCents }
          : {}),
      },
    },
    { account: input.account, idempotencyKey: `checkout:${input.reference}` },
  );

  if (!session.url) {
    throw new StripeError("Stripe created a checkout with no URL to send anyone to.", 502);
  }
  return { id: session.id, url: session.url };
}

// ── Connect ───────────────────────────────────────────────────────────────────

/** Where to send a treasurer to link their club's Stripe account. */
export function connectAuthorizeUrl(
  env: StripeEnv,
  state: string,
  suggest?: { email?: string | null; clubName?: string | null },
): string {
  if (!env.STRIPE_CONNECT_CLIENT_ID) throw new StripeNotConfigured();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.STRIPE_CONNECT_CLIENT_ID,
    scope: "read_write",
    state,
    redirect_uri: `${env.APP_URL}/api/stripe/connect/return`,
  });
  // Prefilling saves a volunteer from retyping what we already know.
  if (suggest?.email) params.set("stripe_user[email]", suggest.email);
  if (suggest?.clubName) params.set("stripe_user[business_name]", suggest.clubName);
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
}

/** Exchange the OAuth code for the club's account id. */
export async function exchangeConnectCode(env: StripeEnv, code: string): Promise<string> {
  const res = await stripeCall<{ stripe_user_id?: string }>(
    env,
    "/v1/oauth/token",
    { grant_type: "authorization_code", code },
    // No idempotency key: an authorization code is single-use by construction,
    // so a replay fails at Stripe rather than silently succeeding twice.
    {},
  );
  if (!res.stripe_user_id) {
    throw new StripeError("Stripe linked the account but didn't say which one.", 502);
  }
  return res.stripe_user_id;
}

export interface AccountStatus {
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  defaultCurrency: string;
  /** What Stripe still needs before this account can take money. */
  pending: string[];
}

/**
 * Ask Stripe whether this account can actually take money yet.
 *
 * Worth its own round trip: a treasurer who links an account mid-onboarding
 * gets `charges_enabled: false`, and a Donate button that returns an error to a
 * stranger who wanted to give the club fifty dollars is a worse outcome than no
 * button at all.
 */
export async function accountStatus(env: StripeEnv, account: string): Promise<AccountStatus> {
  const acct = await stripeCall<{
    charges_enabled?: boolean;
    details_submitted?: boolean;
    default_currency?: string;
    requirements?: { currently_due?: string[] };
  }>(env, `/v1/accounts/${account}`, {}, { method: "GET" });

  return {
    chargesEnabled: acct.charges_enabled === true,
    detailsSubmitted: acct.details_submitted === true,
    defaultCurrency: acct.default_currency ?? "usd",
    pending: acct.requirements?.currently_due ?? [],
  };
}

/** Disconnect a club's account. Their data stays theirs; we just stop using it. */
export async function revokeConnect(env: StripeEnv, account: string): Promise<void> {
  if (!env.STRIPE_CONNECT_CLIENT_ID) throw new StripeNotConfigured();
  await stripeCall(
    env,
    "/v1/oauth/deauthorize",
    { client_id: env.STRIPE_CONNECT_CLIENT_ID, stripe_user_id: account },
    {},
  );
}

// ── Webhook signatures ────────────────────────────────────────────────────────

export interface StripeEvent {
  id: string;
  type: string;
  /** Present when the event happened on a connected account. */
  account?: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureError";
  }
}

/** Stripe's default replay window. */
export const SIGNATURE_TOLERANCE_SEC = 300;

/**
 * Parse a `Stripe-Signature` header.
 *
 * Shape: `t=1710000000,v1=abc…,v1=def…`. Several v1 values can appear when a
 * secret is being rotated, and *any* of them matching is a valid signature —
 * which is precisely what makes a zero-downtime rotation possible.
 */
export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }
  return { timestamp, signatures };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare without leaking where two strings first differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a webhook and return the event.
 *
 * The raw body text must be exactly what arrived — parsing and re-serialising
 * the JSON first changes the bytes and the signature will never match. That is
 * the single most common way this integration is got wrong.
 *
 * Everything that fails here throws. A webhook endpoint that accepts an
 * unverified body is an endpoint where anyone on the internet can mark a club's
 * invoices paid.
 */
export async function verifyWebhook(
  payload: string,
  signatureHeader: string | null,
  secret: string | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = SIGNATURE_TOLERANCE_SEC,
): Promise<StripeEvent> {
  if (!secret) throw new SignatureError("No webhook secret is configured.");
  if (!signatureHeader) throw new SignatureError("No Stripe-Signature header.");

  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    throw new SignatureError("Malformed Stripe-Signature header.");
  }

  // Reject replays. Without this, a signature captured once stays valid
  // forever, and one intercepted "payment succeeded" could be resent nightly.
  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    throw new SignatureError("Signature timestamp is outside the tolerance window.");
  }

  const expected = await hmacHex(secret, `${timestamp}.${payload}`);
  if (!signatures.some((s) => timingSafeEqual(s, expected))) {
    throw new SignatureError("Signature does not match.");
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    throw new SignatureError("Webhook body is not JSON.");
  }
  if (!event.id || !event.type) throw new SignatureError("Webhook body is not a Stripe event.");
  return event;
}

/** Sign a payload the way Stripe does. Exists so the tests can be honest. */
export async function signPayload(
  payload: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${payload}`)}`;
}
