import { Form, Link } from "react-router";
import type { Route } from "./+types/home";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { WEEKLY_SIGNAL_CAP } from "@domain/signals";
import { setupProgress } from "@db/services/onboarding";
import { clubCounts } from "@db/services/membership";
import { nextMeeting } from "@db/services/meetings";
import {
  PageHeader, Card, Chip, Empty, Button, ButtonLink, toneFor, statusLabel, formatDate,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("This week");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  if (!ctx.tenantId) return { needsTenant: true as const };

  const db = ctx.db();
  const club = await db.first<{ id: string; name: string }>("clubs", { columns: "id, name" });
  if (!club) return { needsTenant: true as const };

  // Independent reads, resolved together. Six sequential awaits here would be
  // six round trips on every dashboard load.
  const [signals, health, counts, setup, meeting] = await Promise.all([
    db.all<{
      id: string; kind: string; severity: string; title: string; summary: string;
      suggested_action: string | null; evidence: string; person_id: string | null;
    }>("signals", {
      columns: "id, kind, severity, title, summary, suggested_action, evidence, person_id",
      where: "status = 'open'",
      orderBy: "created_at DESC",
      limit: WEEKLY_SIGNAL_CAP,
    }),
    db.first<{ score: number; status: string; drivers: string; as_of: string }>(
      "club_health_snapshots",
      { where: "club_id = ?", params: [club.id], orderBy: "as_of DESC" },
    ),
    clubCounts(db, club.id, ctx.today),
    setupProgress(db, club.id),
    nextMeeting(db, club.id, ctx.today),
  ]);

  const drivers = health ? safeParse(health.drivers) : null;

  return {
    needsTenant: false as const,
    club,
    signals,
    counts,
    setup,
    nextMeeting: meeting ? { id: meeting.id, date: meeting.meeting_date, topic: meeting.speaker_topic } : null,
    health: health
      ? {
          score: health.score,
          status: health.status,
          asOf: health.as_of,
          reasons: (drivers?.reasons ?? []) as string[],
          actions: (drivers?.actions ?? []) as string[],
        }
      : null,
  };
}

/** Dismiss a signal. Recording why keeps the list honest over time. */
export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const form = await request.formData();
  await db.update("signals", String(form.get("signalId") ?? ""), {
    status: "dismissed",
    dismissed_at: ctx.now,
    dismissed_by: ctx.user?.id ?? null,
    dismiss_reason: String(form.get("reason") ?? "") || null,
  });
  return { ok: true };
}

export default function AppHome({ loaderData }: Route.ComponentProps) {
  if (loaderData.needsTenant) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
          You're not in a club yet
        </h1>
        <p className="mt-3 text-pretty text-ink-600 dark:text-ink-400">
          Your account exists, but it isn't attached to a club or district. Whoever invited you
          can add you — or if you're setting the club up, start there.
        </p>
      </div>
    );
  }

  const { club, signals, counts, setup, health, nextMeeting } = loaderData;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="This week"
        subtitle={`The few things worth doing at ${club.name}.`}
        action={
          health ? (
            <div className="text-right">
              <Chip tone={toneFor(health.status)}>{statusLabel(health.status)}</Chip>
              <div className="mt-1 text-xs text-ink-500">as of {formatDate(health.asOf)}</div>
            </div>
          ) : undefined
        }
      />

      {/* ── Setup, until it's done ── */}
      {!setup.complete && (
        <Card className="mb-8 border-brand-300 dark:border-brand-700">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Getting set up</h2>
          <ol className="mt-4 space-y-3">
            {setup.steps.map((s) => (
              <li key={s.key} className="flex gap-3">
                <span
                  aria-hidden
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${s.done ? "bg-steady-500" : "bg-ink-300"}`}
                />
                <div className="min-w-0">
                  <Link
                    to={s.href}
                    prefetch="intent"
                    className={`-my-1.5 inline-block py-1.5 text-sm ${
                      s.done
                        ? "text-ink-500 line-through"
                        : "font-medium text-ink-900 hover:text-brand-600 dark:text-ink-100"
                    }`}
                  >
                    {s.label}
                  </Link>
                  {!s.done && (
                    <p className="mt-0.5 text-sm text-pretty text-ink-600 dark:text-ink-400">
                      {s.why}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* ── The numbers ── */}
      <div className="grid grid-cols-2 gap-4 pb-8 sm:grid-cols-4">
        <Stat label="Members" value={counts.active} to="/app/people" />
        <Stat label="On their way in" value={counts.pipeline} to="/app/membership" />
        <Stat label="Drifting" value={counts.atRisk} to="/app/membership" alert={counts.atRisk > 0} />
        <Stat
          label="Next meeting"
          value={nextMeeting ? formatDate(nextMeeting.date).replace(/ \d{4}$/, "") : "—"}
          to="/app/meetings"
        />
      </div>

      {/* ── The list ── */}
      {signals.length === 0 ? (
        <Empty
          title="Nothing needs you this week."
          body="No guests waiting on a reply, nobody drifting. We'll say something the moment that changes."
        />
      ) : (
        <ul className="space-y-4">
          {signals.map((s) => (
            <li key={s.id}>
              <Card>
                <div className="flex items-start justify-between gap-4">
                  <h2 className="font-medium text-ink-900 dark:text-ink-100">
                    {s.person_id ? (
                      <Link
                        to={`/app/people/${s.person_id}`}
                        prefetch="intent"
                        className="hover:text-brand-600"
                      >
                        {s.title}
                      </Link>
                    ) : (
                      s.title
                    )}
                  </h2>
                  {s.severity !== "info" && (
                    <Chip tone={s.severity === "urgent" ? "risk" : "watch"}>
                      {s.severity === "urgent" ? "this week" : "soon"}
                    </Chip>
                  )}
                </div>

                <p className="mt-1.5 text-pretty text-ink-600 dark:text-ink-400">{s.summary}</p>
                {s.suggested_action && (
                  <p className="mt-3 text-sm text-pretty text-ink-700 dark:text-ink-300">
                    {s.suggested_action}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-4">
                  {/* Every signal can always answer this. A number nobody can
                      interrogate is a number nobody trusts twice. */}
                  <details className="flex-1">
                    <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-700">
                      Why am I seeing this?
                    </summary>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      {Object.entries(safeParse(s.evidence)).map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-ink-500">{k.replace(/_/g, " ")}</dt>
                          <dd className="text-ink-700 dark:text-ink-300">{String(v ?? "—")}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  <Form method="post">
                    <input type="hidden" name="signalId" value={s.id} />
                    <Button type="submit" variant="quiet">
                      Not this one
                    </Button>
                  </Form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* ── Club health, with its reasons ── */}
      {health && health.reasons.length > 0 && (
        <Card className="mt-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">About the club overall</h2>
          <ul className="mt-3 space-y-1 text-sm text-ink-700 dark:text-ink-300">
            {health.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {health.actions.length > 0 && (
            <div className="mt-4 border-t border-ink-200 pt-4 dark:border-ink-800">
              <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">
                Worth trying
              </p>
              <ul className="mt-2 space-y-1.5 text-sm text-pretty text-ink-700 dark:text-ink-300">
                {health.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  to,
  alert = false,
}: {
  label: string;
  value: string | number;
  to: string;
  alert?: boolean;
}) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className="rounded-xl border border-ink-200 px-4 py-3 hover:border-ink-300 dark:border-ink-800"
    >
      <div
        className={`text-2xl font-semibold tabular-nums ${alert ? "text-risk-500" : "text-ink-900 dark:text-ink-100"}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </Link>
  );
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
