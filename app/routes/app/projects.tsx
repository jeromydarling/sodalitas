import { Form, Link } from "react-router";
import type { Route } from "./+types/projects";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import {
  listProjects, listParticipants, createProject, addParticipant, setHours,
  removeParticipant, updateProject,
  AREAS_OF_FOCUS, PROJECT_STATUS_LABELS, type ProjectStatus,
} from "@db/services/work";
import { listPeople, displayName } from "@db/services/people";
import {
  PageHeader, Card, Chip, Empty, Button, Field, Input, Select, Textarea, formatDate, money,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Projects");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("projects.read");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string }>("clubs", { columns: "id, name" });
  if (!club) return { club: null, projects: [], people: [], canWrite: false, today: ctx.today };

  const projects = await listProjects(db, club.id);
  const [rosters, page] = await Promise.all([
    Promise.all(projects.map((p) => listParticipants(db, p.id))),
    listPeople(db, { role: "member", clubId: club.id, limit: 300 }),
  ]);

  return {
    club,
    today: ctx.today,
    canWrite: ctx.can("projects.write", club.id),
    people: page.people.map((p) => ({ id: p.id, name: displayName(p) })),
    projects: projects.map((p, i) => ({
      id: p.id,
      name: p.name,
      summary: p.summary,
      areaOfFocus: p.area_of_focus,
      status: p.status,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      budgetCents: p.budget_cents,
      spentCents: p.spent_cents,
      peopleServed: p.people_served,
      outcomeNotes: p.outcome_notes,
      totalHours: p.total_hours,
      participants: (rosters[i] ?? []).map((r) => ({
        id: r.id,
        personId: r.person_id,
        name: `${r.preferred_name || r.first_name} ${r.last_name}`,
        role: r.role,
        hours: r.hours,
      })),
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };
  ctx.require("projects.write", club.id);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "What's the project called?" };
    const budget = String(form.get("budget") ?? "").trim();
    await createProject(
      db,
      {
        clubId: club.id,
        name,
        summary: String(form.get("summary") ?? "") || null,
        areaOfFocus: String(form.get("areaOfFocus") ?? "") || null,
        status: (String(form.get("status") ?? "planned") as ProjectStatus) || "planned",
        startsOn: String(form.get("startsOn") ?? "") || null,
        // Dollars in, cents stored. The conversion happens once, here.
        budgetCents: budget ? Math.round(Number(budget) * 100) : 0,
      },
      ctx.now,
    );
    return { ok: true };
  }

  if (intent === "join") {
    const added = await addParticipant(
      db,
      {
        projectId: String(form.get("projectId") ?? ""),
        clubId: club.id,
        personId: String(form.get("personId") ?? ""),
        role: String(form.get("role") ?? "volunteer"),
      },
      ctx.now,
      ctx.user?.id ?? null,
    );
    return added ? { ok: true } : { error: "They're already signed up for that one." };
  }

  if (intent === "hours") {
    const hours = Number(form.get("hours") ?? 0);
    if (!Number.isFinite(hours) || hours < 0) return { error: "Hours need to be a number." };
    await setHours(db, String(form.get("participantId") ?? ""), hours);
    return { ok: true };
  }

  if (intent === "leave") {
    await removeParticipant(db, String(form.get("participantId") ?? ""), ctx.now);
    return { ok: true };
  }

  if (intent === "close") {
    await updateProject(
      db,
      String(form.get("projectId") ?? ""),
      {
        status: "complete",
        endsOn: ctx.today,
        peopleServed: Number(form.get("peopleServed") ?? 0) || null,
        outcomeNotes: String(form.get("outcomeNotes") ?? "") || null,
      },
      ctx.now,
    );
    return { ok: true };
  }

  return { error: "Nothing to do." };
}

export default function Projects({ loaderData, actionData }: Route.ComponentProps) {
  const { club, projects, people, canWrite, today } = loaderData;

  if (!club) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Empty title="No club yet" body="This account isn't attached to a club." />
      </div>
    );
  }

  const totalHours = projects.reduce((n, p) => n + p.totalHours, 0);
  const totalServed = projects.reduce((n, p) => n + (p.peopleServed ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Service projects"
        subtitle="What the club is actually doing, who's doing it, and what came of it."
      />

      {(totalHours > 0 || totalServed > 0) && (
        <div className="grid grid-cols-2 gap-4 pb-8 sm:grid-cols-3">
          <Stat label="Projects" value={projects.length} />
          <Stat label="Volunteer hours" value={Math.round(totalHours)} />
          <Stat label="People served" value={totalServed} />
        </div>
      )}

      {actionData && "error" in actionData && actionData.error && (
        <p className="mb-6 rounded-lg bg-risk-500/10 px-4 py-3 text-sm text-risk-500">
          {actionData.error}
        </p>
      )}

      {projects.length === 0 ? (
        <Empty
          title="No projects yet"
          body="Pick one small thing with a date on it. Momentum matters more than scale, and a project is the fastest way to get quiet members involved again."
        />
      ) : (
        <div className="space-y-5">
          {projects.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-medium text-ink-900 dark:text-ink-100">{p.name}</h2>
                  {p.summary && (
                    <p className="mt-0.5 text-sm text-pretty text-ink-600 dark:text-ink-400">
                      {p.summary}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-500">
                    {p.areaOfFocus && <span>{p.areaOfFocus}</span>}
                    {p.startsOn && <span>from {formatDate(p.startsOn)}</span>}
                    {p.budgetCents > 0 && (
                      <span>
                        {money(p.spentCents)} of {money(p.budgetCents)}
                      </span>
                    )}
                  </div>
                </div>
                <Chip tone={p.status === "active" ? "steady" : p.status === "complete" ? "brand" : "neutral"}>
                  {PROJECT_STATUS_LABELS[p.status]}
                </Chip>
              </div>

              {p.participants.length > 0 && (
                <ul className="mt-4 divide-y divide-ink-100 dark:divide-ink-800/60">
                  {p.participants.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <Link
                          to={`/app/people/${v.personId}`}
                          prefetch="intent"
                          className="text-sm text-ink-800 hover:text-brand-600 dark:text-ink-200"
                        >
                          {v.name}
                        </Link>
                        {v.role === "lead" && <Chip tone="brand">Lead</Chip>}
                      </div>
                      {canWrite ? (
                        <Form method="post" className="flex items-center gap-2">
                          <input type="hidden" name="intent" value="hours" />
                          <input type="hidden" name="participantId" value={v.id} />
                          <Input
                            name="hours"
                            type="number"
                            step="0.5"
                            min="0"
                            defaultValue={v.hours}
                            aria-label={`Hours for ${v.name}`}
                            className="w-20"
                          />
                          <span className="text-xs text-ink-500">hrs</span>
                          <Button type="submit" variant="quiet">
                            Save
                          </Button>
                        </Form>
                      ) : (
                        <span className="text-sm text-ink-500">{v.hours} hrs</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canWrite && p.status !== "complete" && (
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <Form method="post" className="flex flex-1 flex-wrap items-end gap-3">
                    <input type="hidden" name="intent" value="join" />
                    <input type="hidden" name="projectId" value={p.id} />
                    <div className="min-w-48 flex-1">
                      <Select name="personId" aria-label={`Sign someone up for ${p.name}`} required>
                        <option value="">Sign someone up…</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Select name="role" defaultValue="volunteer" aria-label="Role" className="w-auto">
                      <option value="volunteer">Volunteer</option>
                      <option value="lead">Lead</option>
                    </Select>
                    <Button type="submit" variant="secondary">
                      Add
                    </Button>
                  </Form>
                </div>
              )}

              {/* Closing a project asks for the outcome while anyone still
                  remembers it. A project finished six months ago with a blank
                  outcome is a grant application nobody can write. */}
              {canWrite && p.status === "active" && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-ink-500 hover:text-ink-700">
                    Mark it finished
                  </summary>
                  <Form method="post" className="mt-3 space-y-3">
                    <input type="hidden" name="intent" value="close" />
                    <input type="hidden" name="projectId" value={p.id} />
                    <Field label="How many people did it reach?" name={`served-${p.id}`}>
                      <Input id={`served-${p.id}`} name="peopleServed" type="number" min="0" />
                    </Field>
                    <Field
                      label="What came of it?"
                      name={`outcome-${p.id}`}
                      hint="A couple of sentences now saves guessing at grant time."
                    >
                      <Textarea id={`outcome-${p.id}`} name="outcomeNotes" rows={2} />
                    </Field>
                    <Button type="submit" variant="secondary">
                      Finish
                    </Button>
                  </Form>
                </details>
              )}

              {p.status === "complete" && p.outcomeNotes && (
                <div className="mt-4 border-t border-ink-200 pt-3 dark:border-ink-800">
                  <p className="text-sm text-pretty text-ink-700 dark:text-ink-300">
                    {p.outcomeNotes}
                  </p>
                  {p.peopleServed ? (
                    <p className="mt-1 text-xs text-ink-500">Reached {p.peopleServed} people.</p>
                  ) : null}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {canWrite && (
        <Card className="mt-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Start a project</h2>
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="create" />
            <Field label="Name" name="name">
              <Input id="name" name="name" required placeholder="Winter coat drive" />
            </Field>
            <Field label="In a sentence" name="summary">
              <Input id="summary" name="summary" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Area of focus" name="areaOfFocus" hint="What grant applications ask for.">
                <Select id="areaOfFocus" name="areaOfFocus" defaultValue="">
                  <option value="">Not sure yet</option>
                  {AREAS_OF_FOCUS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Starts" name="startsOn">
                <Input id="startsOn" name="startsOn" type="date" defaultValue={today} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Budget" name="budget" hint="In dollars. Optional.">
                <Input id="budget" name="budget" type="number" min="0" step="1" />
              </Field>
              <Field label="Status" name="status">
                <Select id="status" name="status" defaultValue="planned">
                  <option value="planned">Planned</option>
                  <option value="active">Underway</option>
                </Select>
              </Field>
            </div>
            <Button type="submit">Add it</Button>
          </Form>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800">
      <div className="text-2xl font-semibold tabular-nums text-ink-900 dark:text-ink-100">{value}</div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </div>
  );
}
