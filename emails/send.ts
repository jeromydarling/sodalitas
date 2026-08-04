/**
 * send.ts — outbound email.
 *
 * Every send goes through here, and every send is recorded in `email_messages`
 * whether or not it actually left the building. With no provider configured the
 * status is `logged_only` and the body is printed to the console — which means
 * sign-in links work in local development with no account anywhere, and a club
 * can use the whole product before anyone touches DNS.
 *
 * Three transports, chosen at call time by what exists:
 *
 *   1. **Cloudflare Email Service**, via the `EMAIL` binding. Preferred, because
 *      it needs no secret at all — the binding either exists or it doesn't — and
 *      because DKIM and ARC signing are handled for us.
 *   2. **Resend**, if `RESEND_API_KEY` is set. Kept as an escape hatch: Email
 *      Sending requires the domain to be on Cloudflare DNS, and not every
 *      deployment will be.
 *   3. **Nothing**, which logs. Not an error — the normal state of a fresh
 *      checkout, and the app is fully usable in it.
 *
 * None of the three is required for the product to work.
 */

import { newId } from "@domain/ids";
import type { TenantDb } from "@db/scope";

/**
 * The Cloudflare Email Service binding.
 *
 * Declared structurally rather than imported so this module stays testable off
 * the Workers runtime — and so the shape we actually depend on is written down
 * in one place. The full interface supports cc, bcc, attachments and custom
 * headers; we use none of them, and adding one should mean adding it here
 * deliberately.
 */
export interface SendEmailBinding {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ messageId: string }>;
}

export interface EmailEnv {
  DB: D1Database;
  APP_URL: string;
  MAIL_FROM: string;
  MAIL_REPLY_TO: string;
  /** Cloudflare Email Service. Present whenever the binding is declared. */
  EMAIL?: SendEmailBinding;
  RESEND_API_KEY?: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain text is required; HTML is optional and derived when absent. */
  text: string;
  html?: string;
  /** Groups a conversation on the person's timeline. */
  threadKey?: string;
  personId?: string | null;
  clubId?: string | null;
  templateKey?: string;
  /** Transactional mail ignores the suppression list — see below. */
  transactional?: boolean;
}

export type SendStatus = "sent" | "logged_only" | "suppressed" | "failed";

export type MailProvider = "cloudflare" | "resend" | "none";

export interface SendResult {
  status: SendStatus;
  provider: MailProvider;
  id: string;
  error?: string;
}

/**
 * Which transport this environment will use.
 *
 * One function, so the health endpoint, the settings page and the send path
 * can never disagree about what is configured.
 */
/**
 * Is this tenant the public demo?
 *
 * Cached per isolate. The answer for a given tenant id never changes — the
 * demo keeps its row across reseeds and no real tenant ever becomes one — so
 * this is a handful of queries over a Worker's lifetime rather than one per
 * send.
 */
const demoTenants = new Map<string, boolean>();

async function isDemoTenant(db: TenantDb): Promise<boolean> {
  const cached = demoTenants.get(db.tenantId);
  if (cached !== undefined) return cached;

  let answer = false;
  try {
    const row = await db.unsafeDb
      .prepare(`SELECT is_demo FROM tenants WHERE id = ?`)
      .bind(db.tenantId)
      .first<{ is_demo: number }>();
    answer = row?.is_demo === 1;
  } catch (err) {
    // Fail closed. If we can't tell whether this is the demo, don't send —
    // a lost message is recoverable; mail sent from the demo to a stranger
    // is not.
    console.error("[email] could not determine demo status; refusing to send", err);
    return true;
  }

  demoTenants.set(db.tenantId, answer);
  return answer;
}

export function mailProvider(env: Pick<EmailEnv, "EMAIL" | "RESEND_API_KEY">): MailProvider {
  if (env.EMAIL) return "cloudflare";
  if (env.RESEND_API_KEY) return "resend";
  return "none";
}

/**
 * Send one email.
 *
 * Transactional mail — a sign-in link, a receipt, an invitation the person
 * asked for — bypasses the suppression list. Somebody who unsubscribed from
 * the club newsletter still needs to be able to log in, and treating those two
 * as the same thing is how people get locked out of accounts they still want.
 */
export async function sendEmail(
  env: EmailEnv,
  db: TenantDb,
  email: OutboundEmail,
  now: string,
): Promise<SendResult> {
  const id = newId("email");
  const toNorm = email.to.trim().toLowerCase();

  if (!email.transactional) {
    const suppressed = await db.first<{ reason: string }>("email_suppressions", {
      columns: "reason",
      where: "email_norm = ?",
      params: [toNorm],
    });
    if (suppressed) {
      await record(db, id, env, email, "suppressed", "none", null, now);
      return { status: "suppressed", provider: "none", id };
    }

    // do_not_email is the person's own setting and outranks everything except
    // transactional mail.
    if (email.personId) {
      const person = await db.byId<{ do_not_email: number }>("people", email.personId, {
        columns: "do_not_email",
      });
      if (person?.do_not_email === 1) {
        await record(db, id, env, email, "suppressed", "none", null, now);
        return { status: "suppressed", provider: "none", id };
      }
    }
  }

  /**
   * The demo club never sends. Ever.
   *
   * The backstop behind `requireNotDemo`: that guards the actions we know
   * about, and this catches whatever gets added later by somebody who didn't
   * know the rule. Anyone on the internet can sign in to the demo, so a send
   * path reachable from it is an open relay on a real sending domain — the kind
   * of mistake that costs a sending reputation permanently.
   *
   * Recorded as `logged_only` rather than refused, so the demo still shows a
   * complete member timeline with the message on it.
   */
  if (await isDemoTenant(db)) {
    console.log(`[email] demo tenant — not sending to ${email.to} (${email.subject})`);
    await record(db, id, env, email, "logged_only", "none", null, now);
    return { status: "logged_only", provider: "none", id };
  }

  const provider = mailProvider(env);

  // No transport configured. Not an error — the normal state before a club sets
  // up its sending domain, and the app stays fully usable.
  if (provider === "none") {
    logToConsole(email);
    await record(db, id, env, email, "logged_only", "none", null, now);
    return { status: "logged_only", provider: "none", id };
  }

  logInDevelopment(email);

  try {
    const providerId = await dispatch(env, provider, email);
    await record(db, id, env, email, "sent", provider, providerId, now);
    return { status: "sent", provider, id };
  } catch (err) {
    const message = describeSendError(err);
    await record(db, id, env, email, "failed", provider, null, now, message);
    return { status: "failed", provider, id, error: message };
  }
}

/** Hand one message to whichever transport is in play. */
function dispatch(
  env: EmailEnv,
  provider: MailProvider,
  email: OutboundEmail,
): Promise<string | null> {
  return provider === "cloudflare" ? sendViaCloudflare(env, email) : sendViaResend(env, email);
}

function logToConsole(email: OutboundEmail): void {
  console.log(
    `[email] no provider configured — would send to ${email.to}\n` +
      `  subject: ${email.subject}\n` +
      `  ${email.text.split("\n").join("\n  ")}`,
  );
}

/**
 * Print the message in local development, whatever the transport.
 *
 * `wrangler dev` simulates the EMAIL binding by writing each message to a file
 * under .wrangler/tmp and logging the path. That is fine for inspecting a
 * rendered layout and useless for the thing developers actually do fifty times
 * a day, which is copy a sign-in link out of the console. Before the binding
 * existed the link was right there; adding a transport must not take it away.
 *
 * `import.meta.env.DEV` is a compile-time constant, so this whole branch is
 * removed from the production bundle rather than being a runtime check on
 * every send.
 */
function logInDevelopment(email: OutboundEmail): void {
  if (!import.meta.env?.DEV) return;
  console.log(
    `[email] → ${email.to}\n` +
      `  subject: ${email.subject}\n` +
      `  ${email.text.split("\n").join("\n  ")}`,
  );
}

/**
 * Send through Cloudflare Email Service.
 *
 * The sender must belong to a domain onboarded to Email Service, and before a
 * domain is onboarded an account may only mail addresses it has verified. Both
 * of those surface as thrown errors with a `code`, which is why
 * `describeSendError` bothers to translate them: "E_SENDER_NOT_VERIFIED" tells
 * a club administrator nothing, and the answer is nearly always one specific
 * unfinished step in the dashboard.
 */
async function sendViaCloudflare(env: EmailEnv, email: OutboundEmail): Promise<string | null> {
  const binding = env.EMAIL;
  if (!binding) throw new Error("The EMAIL binding is not available.");

  const result = await binding.send({
    to: email.to,
    from: env.MAIL_FROM,
    replyTo: env.MAIL_REPLY_TO,
    subject: email.subject,
    text: email.text,
    html: email.html ?? textToHtml(email.text),
  });
  return result?.messageId ?? null;
}

/** Error codes Email Service throws, in words somebody can act on. */
const CLOUDFLARE_SEND_ERRORS: Record<string, string> = {
  E_SENDER_NOT_VERIFIED:
    "The sending domain isn't onboarded to Cloudflare Email Service yet, so mail can't go out from this address. Onboard it under Email Service → Email Sending, then try again.",
  E_RECIPIENT_NOT_ALLOWED:
    "Until a sending domain is onboarded, Cloudflare only delivers to addresses verified on the account. This recipient isn't one of them.",
  E_RECIPIENT_SUPPRESSED:
    "Cloudflare is suppressing this address account-wide, usually after a hard bounce or a spam report.",
  E_RATE_LIMIT_EXCEEDED:
    "Cloudflare is rate-limiting sends right now. The message wasn't delivered; it's safe to try again shortly.",
  E_DAILY_LIMIT_EXCEEDED:
    "Today's Cloudflare sending quota is used up. New accounts start small and the limit rises with sending history.",
  E_CONTENT_TOO_LARGE: "The message is over Cloudflare's 5 MiB size limit.",
  E_VALIDATION_ERROR: "Cloudflare rejected one of the addresses as malformed.",
  E_TOO_MANY_RECIPIENTS: "More than 50 recipients on one message.",
};

/**
 * Turn a thrown send error into something worth writing down.
 *
 * Whatever this returns lands in `email_messages.error` and is the only account
 * anyone will have of why a message never arrived, so a bare "failed" here
 * costs somebody an afternoon later.
 */
export function describeSendError(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === "string") {
    const known = CLOUDFLARE_SEND_ERRORS[code];
    // Keep the code alongside the explanation — the explanation is for a human,
    // the code is what matches Cloudflare's own documentation and dashboard.
    return known ? `${code}: ${known}` : `${code}: ${errText(err)}`;
  }
  return errText(err);
}

function errText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  // A thrown Error with an empty message is rare but real, and it would write a
  // blank `error` column — the one answer that tells a later reader nothing at
  // all about why a message never arrived.
  return text.trim() || "The mail transport failed without saying why.";
}

async function sendViaResend(env: EmailEnv, email: OutboundEmail): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      reply_to: env.MAIL_REPLY_TO,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html ?? textToHtml(email.text),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // Surface the provider's own words. A generic "email failed" gives a club
    // admin nothing to act on, and the answer is usually in the provider's
    // message — an unverified domain, a bad address.
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  return data?.id ?? null;
}

async function record(
  db: TenantDb,
  id: string,
  env: EmailEnv,
  email: OutboundEmail,
  status: SendStatus,
  provider: MailProvider,
  providerId: string | null,
  now: string,
  error?: string,
): Promise<void> {
  // Recording must never be what fails a send.
  try {
    await db.insert("email_messages", {
      id,
      club_id: email.clubId ?? null,
      direction: "out",
      template_key: email.templateKey ?? null,
      to_email: email.to,
      from_email: env.MAIL_FROM,
      reply_to: env.MAIL_REPLY_TO,
      subject: email.subject,
      body_text: email.text,
      body_html: email.html ?? null,
      person_id: email.personId ?? null,
      thread_key: email.threadKey ?? null,
      status,
      provider,
      provider_id: providerId,
      error: error ?? null,
      sent_at: status === "sent" ? now : null,
      created_at: now,
    });
  } catch (err) {
    console.error("[email] could not record message", err);
  }
}

/**
 * Send a transactional email with no tenant in hand.
 *
 * Sign-in links are the case: at that point we know an address and nothing
 * else, and requiring a TenantDb would mean resolving a tenant just to record
 * a message. These aren't written to email_messages — the message belongs to
 * no club — but they still degrade to the console when no provider is set, so
 * signing in works on a fresh checkout with no keys at all.
 */
export async function sendTransactional(
  env: EmailEnv,
  email: Omit<OutboundEmail, "transactional">,
): Promise<SendResult> {
  const id = newId("email");
  const provider = mailProvider(env);

  if (provider === "none") {
    logToConsole(email as OutboundEmail);
    return { status: "logged_only", provider: "none", id };
  }

  // Sign-in links come through here. Printing them in development is the whole
  // reason a fresh checkout can log in with no mail account anywhere.
  logInDevelopment(email as OutboundEmail);

  try {
    await dispatch(env, provider, { ...email, transactional: true });
    return { status: "sent", provider, id };
  } catch (err) {
    const message = describeSendError(err);
    // Logged loudly because there is no email_messages row to find later. A
    // sign-in link that silently failed is somebody locked out with no trace.
    console.error(`[email] send failed to ${email.to}: ${message}`);
    return { status: "failed", provider, id, error: message };
  }
}

/** Minimal text→HTML. Deliberately plain: club email should look like email. */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb">$1</a>',
  );
  return (
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;` +
    `font-size:15px;line-height:1.6;color:#1f2937;max-width:34em">` +
    linked.split("\n\n").map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("") +
    `</div>`
  );
}

/**
 * Fire-and-forget send.
 *
 * A club officer pressing "save" should not wait on an SMTP round trip, and a
 * provider having a bad afternoon should not fail their action. The send is
 * recorded either way, so nothing is lost even when the response has already
 * gone back.
 */
export function sendInBackground(
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  promise: Promise<unknown>,
): void {
  if (ctx) ctx.waitUntil(promise);
  else void promise.catch((err) => console.error("[email] background send failed", err));
}

// ── Suppression ───────────────────────────────────────────────────────────────

export async function suppress(
  db: TenantDb,
  email: string,
  reason: "unsubscribed" | "bounced" | "complained" | "manual",
  now: string,
): Promise<void> {
  const norm = email.trim().toLowerCase();
  const existing = await db.first<{ id: string }>("email_suppressions", {
    columns: "id",
    where: "email_norm = ?",
    params: [norm],
  });
  if (existing) return;
  await db.insert("email_suppressions", {
    id: newId("suppression"),
    email_norm: norm,
    reason,
    created_at: now,
  });
}

export async function isSuppressed(db: TenantDb, email: string): Promise<boolean> {
  const row = await db.first<{ id: string }>("email_suppressions", {
    columns: "id",
    where: "email_norm = ?",
    params: [email.trim().toLowerCase()],
  });
  return row !== null;
}
