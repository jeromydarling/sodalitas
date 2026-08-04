/**
 * sites.ts — the website work that happens on a schedule.
 *
 * Two things, both of which are "somebody set this up and then went away":
 *
 *   A page told to publish itself on Thursday evening. The club is not going
 *   to be sitting at a screen at eight o'clock, which is the entire point of
 *   scheduling it.
 *
 *   A custom hostname waiting on DNS. Between the club adding the record at
 *   their registrar and the certificate issuing there is a gap of anywhere
 *   from two minutes to a day, and nobody should have to sit on the settings
 *   screen pressing a button through it.
 *
 * Both run across every tenant, so both go through the raw binding rather than
 * a TenantDb — they are cron jobs with no tenant to scope to. Each one reads a
 * narrow, indexed set of rows and writes back by primary key, which is the only
 * shape of cross-tenant work this codebase allows without a conversation.
 */

import { tenantDb } from "@db/scope";
import { pageById, publishPage, updateDomainStatus, type DomainRow } from "@db/services/sites";
import {
  configured,
  createCustomHostname,
  getCustomHostname,
} from "@sites/customHostname";
import type { Env } from "../context";

/** Never more than this many in one run. A backlog drains over a few runs. */
const BATCH = 25;

export async function publishScheduled(env: Env, now: string): Promise<Record<string, unknown>> {
  const due = await env.DB.prepare(
    `SELECT id, tenant_id FROM site_pages
      WHERE status = 'draft' AND scheduled_for IS NOT NULL AND scheduled_for <= ?
      ORDER BY scheduled_for
      LIMIT ?`,
  )
    .bind(now, BATCH)
    .all<{ id: string; tenant_id: string }>();

  const rows = due.results ?? [];
  let published = 0;
  const failures: string[] = [];

  for (const row of rows) {
    try {
      const db = tenantDb(env.DB, row.tenant_id);
      const page = await pageById(db, row.id);
      if (!page) continue;
      // Straight through publishPage rather than an UPDATE, so a scheduled
      // publish leaves the same version row as a manual one. A club looking at
      // the history should not be able to tell which was which.
      await publishPage(db, page, now, null);
      published++;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { scheduled_due: rows.length, published, failures: failures.slice(0, 3) };
}

export async function refreshDomains(env: Env, now: string): Promise<Record<string, unknown>> {
  if (!configured(env)) {
    // Running dark. Clubs can still add domains and read their instructions;
    // this is the job that would activate them, and it honestly does nothing.
    return { checked: 0, mode: "dark", reason: "no Cloudflare credentials configured" };
  }

  const pending = await env.DB.prepare(
    `SELECT * FROM site_domains WHERE status = 'pending' ORDER BY last_checked_at IS NOT NULL, last_checked_at LIMIT ?`,
  )
    .bind(BATCH)
    .all<DomainRow & { tenant_id: string }>();

  const rows = pending.results ?? [];
  let activated = 0;
  let stillWaiting = 0;

  for (const row of rows) {
    const db = tenantDb(env.DB, row.tenant_id);

    // A row with no Cloudflare id was created while we were running dark, or
    // the registration call failed. Either way the fix is the same: register
    // it now.
    const result = row.cf_hostname_id
      ? await getCustomHostname(env, row.cf_hostname_id)
      : await createCustomHostname(env, row.hostname);

    if (!result.ok) {
      // A retryable failure gets picked up next quarter hour. A permanent one
      // is recorded against the row so the club sees it on their screen rather
      // than only in our logs.
      if (!result.dark && !result.retryable) {
        await updateDomainStatus(db, row.id, { status: "error", errors: [result.message] }, now);
      }
      continue;
    }

    await updateDomainStatus(
      db,
      row.id,
      {
        cfHostnameId: result.record.cfId,
        status: result.record.status,
        cfStatus: result.record.cfStatus,
        sslStatus: result.record.sslStatus,
        ownership: result.record.ownership,
        dcv: result.record.dcv,
        errors: result.record.errors,
      },
      now,
    );

    if (result.record.status === "active") activated++;
    else stillWaiting++;
  }

  return { checked: rows.length, activated, still_waiting: stillWaiting };
}

/**
 * Reap domains a club removed a week ago.
 *
 * Removal marks the row deleted rather than deleting it, so a club that
 * removes one by mistake on Tuesday can be helped on Wednesday. After a week
 * the row goes, which is what frees the hostname for anybody else — including
 * the same club setting it up again from scratch.
 */
export async function reapRemovedDomains(env: Env, now: string): Promise<Record<string, unknown>> {
  const cutoff = new Date(Date.parse(now) - 7 * 86400_000).toISOString();
  const result = await env.DB.prepare(
    `DELETE FROM site_domains WHERE status = 'deleted' AND updated_at < ?`,
  )
    .bind(cutoff)
    .run();
  return { domains_reaped: result.meta.changes ?? 0 };
}
