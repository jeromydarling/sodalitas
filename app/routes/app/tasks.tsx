import { Form, Link } from "react-router";
import type { Route } from "./+types/tasks";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { listOpenTasks, completeTask, dismissTask, createTask } from "@db/services/interactions";
import { PageHeader, Card, Chip, Empty, Button, Field, Input, formatDate } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Tasks");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("tasks.read_all");
  const db = ctx.db();

  const tasks = await listOpenTasks(db, { limit: 100 });

  return {
    today: ctx.today,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      details: t.details,
      dueOn: t.due_on,
      overdue: Boolean(t.due_on && t.due_on < ctx.today),
      origin: t.origin,
      assignee: t.assignee_name,
      subjectPersonId: t.subject_person_id,
      subjectName:
        t.subject_first && t.subject_last ? `${t.subject_first} ${t.subject_last}` : null,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("tasks.write");
  const db = ctx.db();

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const title = String(form.get("title") ?? "").trim();
    if (!title) return { error: "What needs doing?" };
    const club = await db.first<{ id: string }>("clubs", { columns: "id" });
    await createTask(
      db,
      {
        clubId: club?.id ?? null,
        title,
        dueOn: String(form.get("dueOn") ?? "") || null,
        createdBy: ctx.user?.id ?? null,
      },
      ctx.now,
    );
    return { ok: true };
  }

  const id = String(form.get("taskId") ?? "");
  if (intent === "done") {
    // Completing a task logs an interaction against the person it was about,
    // so "somebody called Bill" counts as a touch. Without that a club could
    // do everything right and still look neglectful to its own scoring.
    await completeTask(db, id, ctx.user?.id ?? null, ctx.now);
  } else if (intent === "dismiss") {
    await dismissTask(db, id, ctx.now);
  }
  return { ok: true };
}

export default function Tasks({ loaderData, actionData }: Route.ComponentProps) {
  const { tasks, today } = loaderData;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Tasks"
        subtitle="What's outstanding, and who it's about. Nothing here was invented — each one came from something the club noticed."
      />

      <Card className="mb-8">
        <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input type="hidden" name="intent" value="create" />
          <Field label="Add a task" name="title">
            <Input id="title" name="title" required placeholder="Call Margaret about the coat drive" />
          </Field>
          <Field label="Due" name="dueOn">
            <Input id="dueOn" name="dueOn" type="date" />
          </Field>
          <div className="flex items-end">
            <Button type="submit">Add</Button>
          </div>
        </Form>
        {actionData?.error && <p className="mt-3 text-sm text-risk-500">{actionData.error}</p>}
      </Card>

      {tasks.length === 0 ? (
        <Empty
          title="Nothing outstanding"
          body="No follow-ups waiting and nobody needing a call. We'll add something here the moment that changes."
        />
      ) : (
        <ul className="space-y-3">
          {tasks.map((t) => (
            <li key={t.id}>
              <Card className="flex flex-wrap items-start justify-between gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900 dark:text-ink-100">{t.title}</span>
                    {t.origin === "signal" && <Chip tone="brand">noticed for you</Chip>}
                    {t.overdue && <Chip tone="watch">overdue</Chip>}
                  </div>
                  {t.details && (
                    <p className="mt-1 text-sm text-pretty whitespace-pre-line text-ink-600 dark:text-ink-400">
                      {t.details}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-500">
                    {t.subjectName && t.subjectPersonId && (
                      <Link
                        to={`/app/people/${t.subjectPersonId}`}
                        prefetch="intent"
                        className="hover:text-brand-600"
                      >
                        {t.subjectName}
                      </Link>
                    )}
                    {t.dueOn && <span>due {formatDate(t.dueOn)}</span>}
                    {t.assignee && <span>{t.assignee}</span>}
                  </div>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Form method="post">
                    <input type="hidden" name="intent" value="done" />
                    <input type="hidden" name="taskId" value={t.id} />
                    <Button type="submit" variant="secondary">
                      Done
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="dismiss" />
                    <input type="hidden" name="taskId" value={t.id} />
                    <Button type="submit" variant="quiet">
                      Not needed
                    </Button>
                  </Form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
