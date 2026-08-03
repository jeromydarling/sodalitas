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

type Job = (env: Env) => Promise<Record<string, unknown>>;

/**
 * The jobs themselves.
 *
 * Each is a placeholder returning an honest zero until its pipeline lands, so
 * the schedule, the health recording and the wiring are exercised from day one
 * rather than being written blind on the day the first real job ships.
 */
const JOBS: Record<JobKey, Job> = {
  /** Recompute club health and member engagement for every active tenant. */
  async nightly_snapshots(env) {
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM clubs WHERE status = 'active'`,
    ).all<{ n: number }>();
    return { clubs_eligible: results?.[0]?.n ?? 0, snapshots_written: 0, pending: "scoring pipeline" };
  },

  /** Generate the week's signals from the latest snapshots. */
  async weekly_signals(_env) {
    return { signals_written: 0, pending: "signal pipeline" };
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

  /** Expire stale sessions, tokens and finished import runs. */
  async housekeeping(env) {
    const now = new Date().toISOString();
    const expired = await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`)
      .bind(now)
      .run();
    return { sessions_expired: expired.meta.changes ?? 0 };
  },
};

export const JOB_KEYS = Object.keys(JOBS) as JobKey[];
