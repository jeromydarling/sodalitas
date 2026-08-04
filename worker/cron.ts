/**
 * cron.ts — scheduled work.
 *
 * Each job writes a row to job_runs whether it succeeds or fails, so club
 * health snapshots silently stopping three weeks ago is something we find out
 * from a dashboard rather than from a district governor.
 *
 * Jobs are idempotent. Snapshots are keyed on (club, date) and signals on a
 * dedupe key, so a re-run after a failure repairs the gap instead of doubling
 * the data.
 */

import { newId } from "@domain/ids";
import { runNightlySnapshots, runWeeklySignals } from "./jobs/scoring";
import type { Env } from "./context";

export type JobKey =
  | "nightly_snapshots"
  | "weekly_signals"
  | "outbound_drain"
  | "housekeeping";

/** Maps a cron expression from wrangler.jsonc to the job it runs. */
const SCHEDULE: Record<string, JobKey> = {
  "0 5 * * *": "nightly_snapshots",
  "15 6 * * 1": "weekly_signals",
  "*/15 * * * *": "outbound_drain",
  "0 4 * * 0": "housekeeping",
};

export async function runScheduled(cron: string, env: Env): Promise<void> {
  const job = SCHEDULE[cron];
  if (!job) {
    console.warn(`[cron] no job registered for "${cron}"`);
    return;
  }
  await runJob(job, env);
}

/** Run a job and record the outcome, whatever it is. */
export async function runJob(job: JobKey, env: Env): Promise<void> {
  const startedAt = new Date();
  let status: "ok" | "error" = "ok";
  let stats: Record<string, unknown> = {};
  let error: string | null = null;

  try {
    stats = await JOBS[job](env);
  } catch (err) {
    status = "error";
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[cron:${job}]`, err);
  }

  // Recording the run must not itself be able to fail the run.
  try {
    await env.DB.prepare(
      `INSERT INTO job_runs (id, job_key, status, stats, error, duration_ms, started_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId("jobRun"),
        job,
        status,
        JSON.stringify(stats),
        error,
        Date.now() - startedAt.getTime(),
        startedAt.toISOString(),
        new Date().toISOString(),
      )
      .run();
  } catch (err) {
    console.error(`[cron:${job}] could not record run`, err);
  }
}

/** A job returns whatever stats are worth recording. Serialised into job_runs. */
type JobStats = Record<string, unknown>;
type Job = (env: Env) => Promise<JobStats>;

/**
 * The jobs themselves.
 *
 * Where a pipeline hasn't landed yet the job returns an honest zero with a
 * `pending` note rather than pretending to have done work — so the schedule,
 * the health recording and the wiring are exercised from day one, and the
 * job_runs dashboard never shows a green tick for something that didn't happen.
 */
const JOBS: Record<JobKey, Job> = {
  /** Recompute club health and member engagement for every active club. */
  async nightly_snapshots(env) {
    const now = new Date().toISOString();
    return { ...(await runNightlySnapshots(env, now.slice(0, 10), now)) };
  },

  /** Generate the week's signals from last night's snapshots. */
  async weekly_signals(env) {
    const now = new Date().toISOString();
    return { ...(await runWeeklySignals(env, now.slice(0, 10), now)) };
  },

  /** Send anything queued in email_messages. Degrades to logging with no key. */
  async outbound_drain(env) {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM email_messages WHERE status = 'queued'`,
    ).all<{ n: number }>();
    const queued = results?.[0]?.n ?? 0;
    if (!env.RESEND_API_KEY) {
      // Running dark is a normal state, not a failure. The app is fully usable
      // before a single third-party key exists.
      return { queued, sent: 0, mode: "logged_only", reason: "no mail provider configured" };
    }
    return { queued, sent: 0, pending: "mail adapter" };
  },

  /** Expire stale sessions, and put the demo back the way it was. */
  async housekeeping(env) {
    const now = new Date().toISOString();
    const expired = await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`)
      .bind(now)
      .run();

    // One unsubscribe token is minted per non-transactional send, since we
    // store only the hash and so cannot reuse one. They're small, but they
    // accumulate forever otherwise. The window is long on purpose: people
    // unsubscribe from mail they received a year ago, and a dead opt-out link
    // is worse than the row it saved.
    const { UNSUBSCRIBE_TOKEN_TTL_DAYS } = await import("@emails/unsubscribe");
    const cutoff = new Date(
      Date.now() - UNSUBSCRIBE_TOKEN_TTL_DAYS * 86400_000,
    ).toISOString();
    const staleTokens = await env.DB.prepare(
      `DELETE FROM email_unsubscribe_tokens WHERE created_at < ?`,
    )
      .bind(cutoff)
      .run();

    // The demo is the best sales argument this product has, and anyone can
    // click around in it — including deleting things. Weekly reset, plus a
    // self-heal if it's ever found empty, so it is never broken and never bare.
    let demo: Record<string, unknown> = { reseeded: false };
    try {
      const { reseedDemo, DEMO_SLUG } = await import("@db/services/demo");
      const row = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM people p JOIN tenants t ON t.id = p.tenant_id
                  WHERE t.slug = ? AND t.is_demo = 1) AS n`,
      )
        .bind(DEMO_SLUG)
        .first<{ n: number }>();
      const empty = (row?.n ?? 0) === 0;
      const { stats } = await reseedDemo(env, now);
      demo = { reseeded: true, was_empty: empty, ...stats };
    } catch (err) {
      // A failed demo reset must not fail housekeeping — sessions still needed
      // expiring, and the next run will try again.
      demo = { reseeded: false, error: err instanceof Error ? err.message : String(err) };
    }

    return {
      sessions_expired: expired.meta.changes ?? 0,
      unsubscribe_tokens_pruned: staleTokens.meta.changes ?? 0,
      demo,
    };
  },
};

export const JOB_KEYS = Object.keys(JOBS) as JobKey[];
