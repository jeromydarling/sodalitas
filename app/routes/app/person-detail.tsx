import { Form, Link, data } from "react-router";
import type { Route } from "./+types/person-detail";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { getPerson, getPersonBySlug, displayName, parseRoles } from "@db/services/people";
import { listMembershipsForPerson, listStageHistory, STAGE_LABELS, type Stage } from "@db/services/membership";
import { personTimeline, logInteraction, INTERACTION_LABELS, type InteractionKind } from "@db/services/interactions";
import {
  PageHeader, Card, Table, Th, Td, Chip, Button, Field, Textarea, Select,
  formatDate, relativeDays, toneFor, statusLabel,
} from "~/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return appMeta(loaderData?.person.name ?? "Person");
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("people.read");
  const db = ctx.db();

  // Accept either the slug or the raw id — links in emails carry the slug,
  // links from other records carry the id, and both should work.
  const person =
    (await getPersonBySlug(db, params.personId)) ?? (await getPerson(db, params.personId));
  if (!person) throw data("No such person in this club.", { status: 404 });

  const [memberships, timeline, engagement] = await Promise.all([
    listMembershipsForPerson(db, person.id),
    personTimeline(db, person.id, ctx.user?.id ?? null, 60),
    db.first<{ score: number; risk_level: string; drivers: string; as_of: string }>(
      "member_engagement",
      { where: "person_id = ?", params: [person.id], orderBy: "as_of DESC" },
    ),
  ]);

  const history = memberships[0] ? await listStageHistory(db, memberships[0].id) : [];
  const drivers = engagement ? safeParse(engagement.drivers) : null;

  return {
    person: {
      id: person.id,
      name: displayName(person),
      email: person.email,
      phone: person.phone,
      employer: person.employer,
      jobTitle: person.job_title,
      classification: person.classification,
      city: person.city,
      joinedRotaryOn: person.joined_rotary_on,
      roles: parseRoles(person.roles),
      notes: person.notes,
      doNotEmail: person.do_not_email === 1,
    },
    memberships: memberships.map((m) => ({
      id: m.id,
      stage: m.stage,
      type: m.membership_type,
      joinedOn: m.joined_on,
      endedOn: m.ended_on,
      exitReason: m.exit_reason,
    })),
    history,
    timeline: timeline.map((t) => ({
      id: t.id,
      kind: t.kind,
      subject: t.subject,
      body: t.body,
      actor: t.actor_name,
      isPrivate: t.is_private === 1,
      occurredAt: t.occurred_at,
    })),
    engagement: engagement
      ? {
          score: engagement.score,
          risk: engagement.risk_level,
          asOf: engagement.as_of,
          drivers: (drivers?.drivers ?? []) as { label: string; points: number; max: number }[],
          reasons: (drivers?.reasons ?? []) as string[],
          actions: (drivers?.actions ?? []) as string[],
        }
      : null,
    canWrite: ctx.can("people.write"),
  };
}

/** Log a conversation. The single most useful thing anyone does on this page. */
export async function action({ params, request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("tasks.write");
  const db = ctx.db();

  const person =
    (await getPersonBySlug(db, params.personId)) ?? (await getPerson(db, params.personId));
  if (!person) throw data("No such person in this club.", { status: 404 });

  const form = await request.formData();
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Write a line about what happened and we'll keep it." };

  const membership = (await listMembershipsForPerson(db, person.id))[0];

  await logInteraction(
    db,
    {
      clubId: membership?.club_id ?? null,
      personId: person.id,
      kind: (String(form.get("kind") ?? "note") as InteractionKind) ?? "note",
      body,
      actorUserId: ctx.user?.id ?? null,
      // Private notes are visible only to whoever wrote them. A membership
      // chair's candid line about a difficult conversation should not turn up
      // in front of the whole board.
      isPrivate: form.get("private") === "on",
    },
    ctx.now,
  );

  return { ok: true };
}

const LOGGABLE: InteractionKind[] = ["call", "meeting", "email_out", "note"];

export default function PersonDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { person, memberships, history, timeline, engagement, canWrite } = loaderData;
  const primary = memberships[0];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link to="/app/people" prefetch="intent" className="text-sm text-ink-500 hover:text-ink-800">
        ← People
      </Link>

      <PageHeader
        title={person.name}
        subtitle={
          [person.jobTitle, person.employer].filter(Boolean).join(" · ") ||
          person.classification ||
          undefined
        }
        action={
          primary ? (
            <Chip tone={primary.stage === "at_risk" ? "risk" : primary.stage === "active" ? "steady" : "neutral"}>
              {STAGE_LABELS[primary.stage as Stage] ?? primary.stage}
            </Chip>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          {/* ── Engagement, with the reasons showing ── */}
          {engagement && (
            <Card>
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-medium text-ink-900 dark:text-ink-100">How they're doing</h2>
                <Chip tone={toneFor(engagement.risk)}>{statusLabel(engagement.risk)}</Chip>
              </div>

              {engagement.reasons.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-ink-700 dark:text-ink-300">
                  {engagement.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {engagement.actions.length > 0 && (
                <p className="mt-3 text-sm text-pretty text-ink-700 dark:text-ink-300">
                  {engagement.actions[0]}
                </p>
              )}

              {/* Nothing here is a black box. Every score shows its working. */}
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-700">
                  How this was worked out
                </summary>
                <dl className="mt-3 space-y-1.5 text-sm">
                  {engagement.drivers.map((d) => (
                    <div key={d.label} className="flex justify-between gap-4">
                      <dt className="text-ink-600 dark:text-ink-400">{d.label}</dt>
                      <dd className="shrink-0 tabular-nums text-ink-500">
                        {d.points} / {d.max}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-ink-500">
                  Worked out from attendance, involvement, conversations and dues on{" "}
                  {formatDate(engagement.asOf)}. Rules, not a model — the full method is on our
                  site.
                </p>
              </details>
            </Card>
          )}

          {/* ── Log a conversation ── */}
          {canWrite && (
            <Card>
              <h2 className="font-medium text-ink-900 dark:text-ink-100">Log a conversation</h2>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                A line is enough. This is what tells us someone has actually been in touch.
              </p>
              <Form method="post" className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <Select name="kind" defaultValue="call" aria-label="Kind" className="w-auto">
                    {LOGGABLE.map((k) => (
                      <option key={k} value={k}>
                        {INTERACTION_LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </div>
                <Field label="What happened" name="body">
                  <Textarea id="body" name="body" rows={3} required placeholder="Caught up after the meeting — happy to help with the coat drive." />
                </Field>
                <label className="flex items-center gap-2 text-sm text-ink-600 dark:text-ink-400">
                  <input type="checkbox" name="private" className="rounded border-ink-300" />
                  Keep this one to myself
                </label>
                {actionData?.error && <p className="text-sm text-risk-500">{actionData.error}</p>}
                <Button type="submit">Save</Button>
              </Form>
            </Card>
          )}

          {/* ── Timeline ── */}
          <div>
            <h2 className="pb-3 font-medium text-ink-900 dark:text-ink-100">History</h2>
            {timeline.length === 0 ? (
              <p className="text-sm text-ink-500">
                Nothing logged yet. The first conversation you record starts their history here.
              </p>
            ) : (
              <ol className="space-y-4">
                {timeline.map((t) => (
                  <li key={t.id} className="border-l-2 border-ink-200 pl-4 dark:border-ink-800">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium text-ink-800 dark:text-ink-200">
                        {INTERACTION_LABELS[t.kind as InteractionKind] ?? t.kind}
                      </span>
                      <span className="text-ink-500">{formatDate(t.occurredAt)}</span>
                      {t.actor && <span className="text-ink-500">· {t.actor}</span>}
                      {t.isPrivate && <Chip tone="neutral">private</Chip>}
                    </div>
                    {t.subject && (
                      <p className="mt-0.5 text-sm text-ink-700 dark:text-ink-300">{t.subject}</p>
                    )}
                    {t.body && (
                      <p className="mt-0.5 text-sm text-pretty text-ink-600 dark:text-ink-400">
                        {t.body}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {/* ── Details ── */}
        <aside className="space-y-6">
          <Card>
            <h2 className="text-sm font-medium text-ink-900 dark:text-ink-100">Details</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Detail label="Email" value={person.email} />
              <Detail label="Phone" value={person.phone} />
              <Detail label="Classification" value={person.classification} />
              <Detail label="City" value={person.city} />
              <Detail
                label="In Rotary since"
                value={person.joinedRotaryOn ? formatDate(person.joinedRotaryOn) : null}
              />
              {primary && (
                <Detail label="Joined this club" value={primary.joinedOn ? formatDate(primary.joinedOn) : null} />
              )}
            </dl>
            {person.doNotEmail && (
              <p className="mt-3 rounded-lg bg-ink-500/10 px-3 py-2 text-xs text-ink-600 dark:text-ink-300">
                They've asked not to receive email. We won't send any.
              </p>
            )}
          </Card>

          {history.length > 0 && (
            <Card>
              <h2 className="text-sm font-medium text-ink-900 dark:text-ink-100">
                Membership history
              </h2>
              <ol className="mt-3 space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-3">
                    <span className="text-ink-700 dark:text-ink-300">
                      {STAGE_LABELS[h.to_stage as Stage] ?? h.to_stage}
                    </span>
                    <span className="shrink-0 text-ink-500">{formatDate(h.occurred_at)}</span>
                  </li>
                ))}
              </ol>
              {primary?.exitReason && (
                <p className="mt-3 text-xs text-ink-500">Reason given: {primary.exitReason}</p>
              )}
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right text-ink-800 dark:text-ink-200">{value || "—"}</dd>
    </div>
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
