import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/import";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { planImport, savePlan, commitImport, rollbackImport, listImportRuns } from "@db/services/import";
import { FIELD_LABELS, type ImportField } from "@domain/csv";
import { STAGE_LABELS, type Stage } from "@db/services/membership";
import {
  PageHeader, Card, Table, Th, Td, Chip, Button, Empty, Textarea, Field, formatDate,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Import");
}

/** Rows shown in the preview. Enough to trust it, not so many it's unreadable. */
const PREVIEW_ROWS = 25;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("import.run");
  const db = ctx.db();
  const runs = await listImportRuns(db, 10);
  return {
    runs: runs.map((r) => ({
      id: r.id,
      filename: r.filename,
      mode: r.mode,
      created: r.created_count,
      updated: r.updated_count,
      skipped: r.skipped_count,
      errors: r.error_count,
      createdAt: r.created_at,
      committedAt: r.committed_at,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "plan");

  if (intent === "commit") {
    ctx.require("import.commit", club.id);
    const result = await commitImport(
      db,
      String(form.get("runId") ?? ""),
      club.id,
      ctx.user?.id ?? null,
      ctx.now,
    );
    return { committed: result };
  }

  if (intent === "undo") {
    ctx.require("import.commit", club.id);
    const result = await rollbackImport(db, String(form.get("runId") ?? ""), ctx.now);
    return { undone: result };
  }

  ctx.require("import.run", club.id);
  const csv = String(form.get("csv") ?? "");
  if (!csv.trim()) {
    return { error: "Paste the contents of your CSV export, or drop the file in." };
  }

  // Column overrides come back as mapping.<field> when someone corrects a guess.
  const overrides: Partial<Record<ImportField, string>> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("mapping.") && typeof value === "string" && value) {
      overrides[key.slice("mapping.".length) as ImportField] = value;
    }
  }

  const plan = await planImport(db, csv, overrides);

  // Nothing is written to the club's data here — only the plan itself, so it
  // survives the page reload and can be committed by id.
  const runId =
    plan.blockers.length === 0
      ? await savePlan(
          db,
          { clubId: club.id, filename: String(form.get("filename") ?? "") || null, plan, startedBy: ctx.user?.id ?? null },
          ctx.now,
        )
      : null;

  return {
    plan: {
      runId,
      mapping: plan.mapping,
      headers: plan.headers,
      counts: plan.counts,
      warnings: plan.warnings,
      blockers: plan.blockers,
      rows: plan.rows.slice(0, PREVIEW_ROWS).map((r) => ({
        rowNumber: r.rowNumber,
        action: r.action,
        name: `${r.values.firstName} ${r.values.lastName}`.trim(),
        email: r.values.email,
        stage: r.values.stage,
        matchName: r.matchName,
        matchReason: r.matchReason,
        error: r.error,
      })),
      totalRows: plan.rows.length,
    },
  };
}

export default function Import({ loaderData, actionData }: Route.ComponentProps) {
  const nav = useNavigation();
  const busy = nav.state === "submitting";
  const plan = actionData && "plan" in actionData ? actionData.plan : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Import your roster"
        subtitle="Export a CSV from ClubRunner, DACdb or a spreadsheet. We'll show you exactly what we'd do before anything changes — and you can undo it afterwards."
      />

      {/* ── Outcomes ── */}
      {actionData && "committed" in actionData && actionData.committed && (
        <Card className="mb-6 border-steady-500/40">
          <p className="font-medium text-ink-900 dark:text-ink-100">Imported.</p>
          <p className="mt-1 text-ink-600 dark:text-ink-400">
            {actionData.committed.created} added, {actionData.committed.updated} updated,{" "}
            {actionData.committed.skipped} skipped
            {actionData.committed.failed > 0 && `, ${actionData.committed.failed} couldn't be read`}.
          </p>
          <Link to="/app/people" prefetch="intent" className="mt-3 inline-block text-brand-600 hover:underline">
            See your people →
          </Link>
        </Card>
      )}

      {actionData && "undone" in actionData && actionData.undone && (
        <Card className="mb-6">
          <p className="font-medium text-ink-900 dark:text-ink-100">Undone.</p>
          <p className="mt-1 text-ink-600 dark:text-ink-400">
            Removed the {actionData.undone.removed} people that import added.
            {actionData.undone.kept > 0 &&
              ` The ${actionData.undone.kept} it only updated were already here, so they've been left alone.`}
          </p>
        </Card>
      )}

      {/* ── Paste ── */}
      {!plan && (
        <Card>
          <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="plan" />
            <Field
              label="Paste your CSV"
              name="csv"
              hint="Open the export in a spreadsheet, select everything, and paste. Keep the header row."
            >
              <Textarea
                id="csv"
                name="csv"
                rows={10}
                required
                className="font-mono text-xs"
                placeholder={"First Name,Last Name,Email,Classification\nMargaret,Chen,margaret@example.com,Banking"}
              />
            </Field>
            {actionData && "error" in actionData && actionData.error && (
              <p className="text-sm text-risk-500">{actionData.error}</p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Reading it…" : "Show me what you'd do"}
            </Button>
          </Form>
        </Card>
      )}

      {/* ── The plan ── */}
      {plan && (
        <>
          {plan.blockers.length > 0 && (
            <Card className="mb-6 border-risk-500/40">
              <p className="font-medium text-ink-900 dark:text-ink-100">
                We need a bit more before we can go ahead
              </p>
              <ul className="mt-2 space-y-1 text-ink-600 dark:text-ink-400">
                {plan.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Card>
          )}

          {plan.warnings.length > 0 && (
            <Card className="mb-6">
              <p className="text-sm font-medium text-ink-800 dark:text-ink-200">Worth knowing</p>
              <ul className="mt-2 space-y-1 text-sm text-ink-600 dark:text-ink-400">
                {plan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4 pb-6 sm:grid-cols-4">
            <Count label="To add" value={plan.counts.create} />
            <Count label="To update" value={plan.counts.update} />
            <Count label="To skip" value={plan.counts.skip} />
            <Count label="Can't read" value={plan.counts.error} alert={plan.counts.error > 0} />
          </div>

          <Card className="mb-6">
            <p className="text-sm font-medium text-ink-800 dark:text-ink-200">
              How we read your columns
            </p>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {Object.entries(plan.mapping).map(([field, column]) => (
                <div key={field} className="flex justify-between gap-3">
                  <dt className="text-ink-500">{FIELD_LABELS[field as ImportField]}</dt>
                  <dd className="text-ink-800 dark:text-ink-200">{column}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <h2 className="pb-3 font-medium text-ink-900 dark:text-ink-100">
            The first {Math.min(PREVIEW_ROWS, plan.totalRows)} of {plan.totalRows} rows
          </h2>
          <Table>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Name</Th>
                <Th className="hidden sm:table-cell">Standing</Th>
                <Th>What we'd do</Th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => (
                <tr key={r.rowNumber}>
                  <Td className="text-ink-500 tabular-nums">{r.rowNumber}</Td>
                  <Td>
                    <span className="text-ink-900 dark:text-ink-100">{r.name || "—"}</span>
                    {r.email && <div className="text-xs text-ink-500">{r.email}</div>}
                  </Td>
                  <Td className="hidden text-ink-600 sm:table-cell dark:text-ink-400">
                    {STAGE_LABELS[r.stage as Stage] ?? r.stage}
                  </Td>
                  <Td>
                    <ActionChip action={r.action} />
                    {/* Say why, always. "Skip" without a reason is the kind of
                        thing that makes people abandon an import halfway. */}
                    {(r.matchReason || r.error) && (
                      <div className="mt-0.5 text-xs text-ink-500">
                        {r.error ?? r.matchReason}
                        {r.matchName && !r.error && ` (${r.matchName})`}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="flex flex-wrap items-center gap-4 pt-6">
            {plan.runId && (
              <Form method="post">
                <input type="hidden" name="intent" value="commit" />
                <input type="hidden" name="runId" value={plan.runId} />
                <Button type="submit" disabled={busy}>
                  {busy ? "Importing…" : `Go ahead — import ${plan.counts.create + plan.counts.update} people`}
                </Button>
              </Form>
            )}
            <Link to="/app/import" className="text-sm text-ink-500 hover:text-ink-800">
              Start over
            </Link>
          </div>
        </>
      )}

      {/* ── History ── */}
      {loaderData.runs.length > 0 && !plan && (
        <section className="pt-10">
          <h2 className="pb-3 font-medium text-ink-900 dark:text-ink-100">Previous imports</h2>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Result</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {loaderData.runs.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="text-ink-800 dark:text-ink-200">{formatDate(r.createdAt)}</span>
                    {r.filename && <div className="text-xs text-ink-500">{r.filename}</div>}
                  </Td>
                  <Td className="text-ink-600 dark:text-ink-400">
                    {r.mode === "rolled_back" ? (
                      <Chip tone="neutral">undone</Chip>
                    ) : r.mode === "dry_run" ? (
                      <Chip tone="neutral">not applied</Chip>
                    ) : (
                      `${r.created} added, ${r.updated} updated`
                    )}
                  </Td>
                  <Td>
                    {r.mode === "committed" && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="undo" />
                        <input type="hidden" name="runId" value={r.id} />
                        <Button type="submit" variant="quiet">
                          Undo
                        </Button>
                      </Form>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}

function ActionChip({ action }: { action: string }) {
  if (action === "create") return <Chip tone="steady">add</Chip>;
  if (action === "update") return <Chip tone="brand">update</Chip>;
  if (action === "error") return <Chip tone="risk">can't read</Chip>;
  return <Chip tone="neutral">skip</Chip>;
}

function Count({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-200 px-4 py-3 dark:border-ink-800">
      <div
        className={`text-2xl font-semibold tabular-nums ${alert && value > 0 ? "text-risk-500" : "text-ink-900 dark:text-ink-100"}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </div>
  );
}
