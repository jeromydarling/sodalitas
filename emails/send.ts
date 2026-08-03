/**
 * send.ts — outbound email.
 *
 * Every send goes through here, and every send is recorded in `email_messages`
 * whether or not it actually left the building. With no provider key configured
 * the status is `logged_only` and the body is printed to the console — which
 * means sign-in links work in local development with no account anywhere, and
 * a club can use the whole product before anyone touches DNS.
 *
 * Two provider adapters, chosen at call time by which secret exists. Neither is
 * required for the app to function.
 */

import { newId } from "@domain/ids";
import type { TenantDb } from "@db/scope";

export interface EmailEnv {
  DB: D1Database;
  APP_URL: string;
  MAIL_FROM: string;
  MAIL_REPLY_TO: string;
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

export interface SendResult {
  status: SendStatus;
  provider: "resend" | "none";
  id: string;
  error?: string;
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

  // No provider configured. Not an error — the normal state before a club sets
  // up its sending domain, and the app stays fully usable.
  if (!env.RESEND_API_KEY) {
    console.log(
      `[email] no provider configured — would send to ${email.to}\n` +
        `  subject: ${email.subject}\n` +
        `  ${email.text.split("\n").join("\n  ")}`,
    );
    await record(db, id, env, email, "logged_only", "none", null, now);
    return { status: "logged_only", provider: "none", id };
  }

  try {
    const providerId = await sendViaResend(env, email);
    await record(db, id, env, email, "sent", "resend", providerId, now);
    return { status: "sent", provider: "resend", id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await record(db, id, env, email, "failed", "resend", null, now, message);
    return { status: "failed", provider: "resend", id, error: message };
  }
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
  provider: "resend" | "none",
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

  if (!env.RESEND_API_KEY) {
    console.log(
      `[email] no provider configured — would send to ${email.to}\n` +
        `  subject: ${email.subject}\n` +
        `  ${email.text.split("\n").join("\n  ")}`,
    );
    return { status: "logged_only", provider: "none", id };
  }

  try {
    await sendViaResend(env, { ...email, transactional: true });
    return { status: "sent", provider: "resend", id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] send failed to ${email.to}: ${message}`);
    return { status: "failed", provider: "resend", id, error: message };
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
