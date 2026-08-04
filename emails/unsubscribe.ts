/**
 * unsubscribe.ts — issuing and honouring one-click unsubscribe links.
 *
 * Every non-transactional email carries one. That is a legal requirement in
 * most of the places a Rotary club exists — CAN-SPAM in the US, CASL in Canada,
 * PECR and the GDPR in the UK and EU — and it is also just decency: a club that
 * makes it hard to leave a mailing list is a club people learn not to give
 * their address to.
 *
 * The token is 256 bits of CSPRNG output, stored only as a SHA-256 hash, so a
 * stolen database yields no working links. It is deliberately **not**
 * single-use — see resolveUnsubscribeToken for why.
 */

import { issueToken, hashToken } from "@worker/auth/crypto";
import { newId } from "@domain/ids";
import type { TenantDb } from "@db/scope";

/**
 * Mint an unsubscribe token for one address.
 *
 * A fresh token per send. They can't be reused, because we store only the hash
 * and cannot recover the token to put in a second email — which is the correct
 * trade for a value that must never be guessable. The rows are tiny and the
 * housekeeping job prunes old ones.
 */
export async function issueUnsubscribeToken(
  db: TenantDb,
  emailNorm: string,
  now: string,
): Promise<string> {
  const { token, hash } = await issueToken();
  await db.insert("email_unsubscribe_tokens", {
    token_hash: hash,
    email_norm: emailNorm.trim().toLowerCase(),
    created_at: now,
  });
  return token;
}

/**
 * Act on a click.
 *
 * Idempotent: unsubscribing an already-unsubscribed address is a success, not
 * an error. Somebody clicking twice is checking it worked, and telling them
 * something went wrong is how they end up marking the mail as spam instead —
 * which costs the club its sending reputation, a far more expensive outcome
 * than the unsubscribe itself.
 */
export async function applyUnsubscribe(
  db: TenantDb,
  emailNorm: string,
  now: string,
): Promise<{ alreadyOff: boolean }> {
  const norm = emailNorm.trim().toLowerCase();

  const existing = await db.first<{ id: string }>("email_suppressions", {
    columns: "id",
    where: "email_norm = ?",
    params: [norm],
  });
  if (existing) return { alreadyOff: true };

  await db.insert("email_suppressions", {
    id: newId("suppression"),
    email_norm: norm,
    reason: "unsubscribed",
    created_at: now,
  });

  // Also set the person's own flag where we can match them, so the roster shows
  // it. The suppression list is what actually stops mail; this is so a
  // membership chair looking at somebody's record can see the choice they made
  // rather than wondering why their emails bounce off.
  await db.raw(
    `UPDATE people SET do_not_email = 1, updated_at = ?
      WHERE tenant_id = {{tenant}} AND email_norm = ?`,
    [now, norm],
  );

  return { alreadyOff: false };
}

/**
 * Undo it.
 *
 * Offered on the confirmation page because the commonest reason anyone lands
 * there is a mis-click, and a person who has to email the secretary to get back
 * on the list simply doesn't.
 */
export async function resubscribe(
  db: TenantDb,
  emailNorm: string,
  now: string,
): Promise<void> {
  const norm = emailNorm.trim().toLowerCase();
  await db.raw(
    `DELETE FROM email_suppressions
      WHERE tenant_id = {{tenant}} AND email_norm = ? AND reason = 'unsubscribed'`,
    [norm],
  );
  await db.raw(
    `UPDATE people SET do_not_email = 0, updated_at = ?
      WHERE tenant_id = {{tenant}} AND email_norm = ?`,
    [now, norm],
  );
}

/** Hash a presented token for lookup. Re-exported so routes need one import. */
export { hashToken };

/** How long an unsubscribe token stays resolvable. */
export const UNSUBSCRIBE_TOKEN_TTL_DAYS = 400;
