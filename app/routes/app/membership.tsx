import { Form, Link } from "react-router";
import type { Route } from "./+types/membership";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import {
  listPipeline, moveStage, clubCounts, PIPELINE_STAGES, STAGE_LABELS, type Stage,
} from "@db/services/membership";
import { PageHeader, Card, Chip, Empty, Button, Select, relativeDays } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Membership");
}

/**
 * Past this many days a stage has gone stale. Someone who has been "in
 * conversation" since March is not in conversation, and saying so is the whole
 * value of a pipeline view over a list.
 */
const STALE_DAYS = 45;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("membership.read");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string }>("clubs", { columns: "id, name" });
  if (!club) return { club: null, stages: [], counts: null, canWrite: false };

  const [pipeline, counts] = await Promise.all([
    listPipeline(db, club.id, ctx.today),
    clubCounts(db, club.id, ctx.today),
  ]);

  const stages = PIPELINE_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    people: pipeline
      .filter((p) => p.stage === stage)
      .map((p) => ({
        membershipId: p.id,
        personId: p.person_id,
        name: `${p.preferred_name || p.first_name} ${p.last_name}`,
        stage: p.stage,
        daysInStage: p.days_in_stage,
        stale: p.days_in_stage > STALE_DAYS,
      })),
  }));

  return { club, stages, counts, canWrite: ctx.can("membership.write", club.id) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };
  ctx.require("membership.write", club.id);

  const form = await request.formData();
  const membershipId = String(form.get("membershipId") ?? "");
  const toStage = String(form.get("toStage") ?? "") as Stage;

  const moved = await moveStage(
    db,
    { membershipId, toStage, reason: "Moved by hand", actorUserId: ctx.user?.id ?? null },
    ctx.now,
  );
  if (!moved) return { error: "That person isn't in this club's pipeline any more." };
  return { ok: true };
}

export default function Membership({ loaderData }: Route.ComponentProps) {
  const { club, stages, counts, canWrite } = loaderData;

  if (!club || !counts) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Empty title="No club yet" body="This account isn't attached to a club." />
      </div>
    );
  }

  const total = stages.reduce((n, s) => n + s.people.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Membership"
        subtitle="Everyone on their way in, and how long they've been waiting."
      />

      <div className="grid grid-cols-2 gap-4 pb-8 sm:grid-cols-4">
        <Stat label="Members" value={counts.active} />
        <Stat label="On their way in" value={counts.pipeline} />
        <Stat label="Drifting" value={counts.atRisk} tone={counts.atRisk > 0 ? "risk" : "neutral"} />
        <Stat
          label="Net, 90 days"
          value={`${counts.joined90d - counts.departed90d >= 0 ? "+" : ""}${counts.joined90d - counts.departed90d}`}
          tone={counts.joined90d - counts.departed90d < 0 ? "risk" : "steady"}
        />
      </div>

      {total === 0 ? (
        <Empty
          title="Nobody in the pipeline"
          body="When a guest signs in at a meeting they'll appear here automatically, and we'll remind someone to follow up."
        />
      ) : (
        <div className="space-y-6">
          {stages
            .filter((s) => s.people.length > 0)
            .map((s) => (
              <section key={s.stage}>
                <h2 className="pb-2 text-sm font-medium tracking-wide text-ink-500 uppercase">
                  {s.label} · {s.people.length}
                </h2>
                <div className="space-y-2">
                  {s.people.map((p) => (
                    <Card key={p.membershipId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <Link
                          to={`/app/people/${p.personId}`}
                          prefetch="intent"
                          className="font-medium text-ink-900 hover:text-brand-600 dark:text-ink-100"
                        >
                          {p.name}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
                          <span>Here since {relativeDays(p.daysInStage)}</span>
                          {/* Not an alarm — a nudge. Most stale entries are
                              somebody the club simply forgot to move along. */}
                          {p.stale && <Chip tone="watch">worth a nudge</Chip>}
                        </div>
                      </div>

                      {canWrite && (
                        <Form method="post" className="flex items-center gap-2">
                          <input type="hidden" name="membershipId" value={p.membershipId} />
                          <Select name="toStage" defaultValue={p.stage} aria-label={`Move ${p.name}`} className="w-auto">
                            {PIPELINE_STAGES.map((st) => (
                              <option key={st} value={st}>
                                {STAGE_LABELS[st]}
                              </option>
                            ))}
                            <option value="active">{STAGE_LABELS.active}</option>
                            <option value="resigned">Didn't join</option>
                          </Select>
                          <Button type="submit" variant="secondary">
                            Move
                          </Button>
                        </Form>
                      )}
                    </Card>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "risk" | "steady";
}) {
  const colour =
    tone === "risk"
      ? "text-risk-500"
      : tone === "steady"
        ? "text-steady-500"
        : "text-ink-900 dark:text-ink-100";
  return (
    <div className="rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800">
      <div className={`text-2xl font-semibold tabular-nums ${colour}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </div>
  );
}
