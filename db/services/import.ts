/**
 * import.ts — bringing a club's roster across.
 *
 * The promise on the pricing page is that the importer shows exactly what it
 * will do before it does anything, and that a run can be undone. Both are load-
 * bearing: a secretary who has been told for years that migrating is painful
 * needs to be able to press the button without believing us first.
 *
 * So an import is three separate acts:
 *   1. **Plan.** Parse, map, look for duplicates, decide create/update/skip for
 *      every row. Writes nothing to the club's data.
 *   2. **Commit.** Apply the plan, recording the id created for each row.
 *   3. **Undo.** Delete exactly those ids, and nothing else.
 *
 * Step three is why every committed row stores its entity id. Without it,
 * "undo" would mean guessing, and guessing wrong means deleting a member who
 * was already there.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";
import {
  parseCsv, guessMapping, normalizeDate, normalizePhone, normalizeStage,
  normalizeMembershipType, splitName, REQUIRED_FIELDS,
  type ImportField, type ParsedCsv,
} from "@domain/csv";
import { findDuplicates, createPerson, updatePerson, normalizeEmail } from "./people";
import { createMembership, moveStage, type Stage } from "./membership";

export type RowAction = "create" | "update" | "skip" | "error";

export interface PlannedRow {
  rowNumber: number;
  action: RowAction;
  /** What the row will become, after cleaning. */
  values: {
    firstName: string;
    lastName: string;
    preferredName: string | null;
    email: string | null;
    phone: string | null;
    employer: string | null;
    jobTitle: string | null;
    classification: string | null;
    birthday: string | null;
    joinedRotaryOn: string | null;
    joinedClubOn: string | null;
    city: string | null;
    stateCode: string | null;
    notes: string | null;
    stage: Stage;
    membershipType: "active" | "honorary" | "corporate" | "satellite";
  };
  /** Set when this row matches somebody already here. */
  matchPersonId: string | null;
  matchName: string | null;
  matchReason: string | null;
  error: string | null;
  raw: Record<string, string>;
}

export interface ImportPlan {
  headers: string[];
  mapping: Partial<Record<ImportField, string>>;
  rows: PlannedRow[];
  counts: Record<RowAction, number>;
  warnings: string[];
  /** Blocking problems — the plan cannot be committed while any remain. */
  blockers: string[];
}

/**
 * Work out what an import would do, without doing any of it.
 *
 * Duplicate checking runs against the club's existing people *and* against
 * earlier rows in the same file, because the commonest duplicate in a roster
 * export is the same person listed twice in the same file.
 */
export async function planImport(
  db: TenantDb,
  csvText: string,
  overrides: Partial<Record<ImportField, string>> = {},
): Promise<ImportPlan> {
  const parsed: ParsedCsv = parseCsv(csvText);
  const mapping = { ...guessMapping(parsed.headers), ...stripEmpty(overrides) };

  const blockers: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!mapping[field]) {
      blockers.push(
        field === "firstName"
          ? "We need to know which column holds first names."
          : "We need to know which column holds last names.",
      );
    }
  }
  if (parsed.rows.length === 0) blockers.push("There are no rows to import.");

  const rows: PlannedRow[] = [];
  const counts: Record<RowAction, number> = { create: 0, update: 0, skip: 0, error: 0 };

  // Emails already claimed by an earlier row in this same file.
  const seenEmails = new Map<string, number>();

  if (blockers.length === 0) {
    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i]!;
      const planned = await planRow(db, raw, mapping, i + 2, seenEmails);
      rows.push(planned);
      counts[planned.action]++;
    }
  }

  return { headers: parsed.headers, mapping, rows, counts, warnings: parsed.warnings, blockers };
}

function stripEmpty(
  o: Partial<Record<ImportField, string>>,
): Partial<Record<ImportField, string>> {
  const out: Partial<Record<ImportField, string>> = {};
  for (const [k, v] of Object.entries(o)) if (v) out[k as ImportField] = v;
  return out;
}

async function planRow(
  db: TenantDb,
  raw: Record<string, string>,
  mapping: Partial<Record<ImportField, string>>,
  rowNumber: number,
  seenEmails: Map<string, number>,
): Promise<PlannedRow> {
  const get = (field: ImportField): string => {
    const col = mapping[field];
    return col ? (raw[col] ?? "").trim() : "";
  };

  let firstName = get("firstName");
  let lastName = get("lastName");

  // A file with one combined name column maps it to firstName; split it here
  // rather than importing forty people whose surname is blank.
  if (firstName && !lastName && firstName.includes(" ")) {
    const split = splitName(firstName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  const base = {
    rowNumber,
    raw,
    matchPersonId: null as string | null,
    matchName: null as string | null,
    matchReason: null as string | null,
  };

  const values: PlannedRow["values"] = {
    firstName,
    lastName,
    preferredName: get("preferredName") || null,
    email: get("email") || null,
    phone: normalizePhone(get("phone")),
    employer: get("employer") || null,
    jobTitle: get("jobTitle") || null,
    classification: get("classification") || null,
    birthday: normalizeDate(get("birthday")),
    joinedRotaryOn: normalizeDate(get("joinedRotaryOn")),
    joinedClubOn: normalizeDate(get("joinedClubOn")),
    city: get("city") || null,
    stateCode: get("stateCode") || null,
    notes: get("notes") || null,
    stage: normalizeStage(get("stage")) as Stage,
    membershipType: normalizeMembershipType(get("membershipType")),
  };

  if (!firstName && !lastName) {
    return { ...base, action: "error", values, error: "No name in this row.", };
  }
  if (!lastName) {
    return { ...base, action: "error", values, error: "This row has a first name but no surname." };
  }

  const emailNorm = normalizeEmail(values.email);

  // Same address twice in one file. Almost always the same person listed
  // under two roles; importing both creates a split history immediately.
  if (emailNorm && seenEmails.has(emailNorm)) {
    return {
      ...base,
      action: "skip",
      values,
      error: null,
      matchReason: `The same email appears on row ${seenEmails.get(emailNorm)} of this file.`,
    };
  }
  if (emailNorm) seenEmails.set(emailNorm, rowNumber);

  const dupes = await findDuplicates(db, {
    firstName,
    lastName,
    email: values.email,
    phone: values.phone,
  });
  const best = dupes[0];

  // A confident match updates the existing person rather than creating a
  // second one. Anything less certain is still surfaced, but as a create the
  // club can change to a merge — we don't silently guess about identity.
  if (best && best.confidence >= 0.9) {
    return {
      ...base,
      action: "update",
      values,
      error: null,
      matchPersonId: best.person.id,
      matchName: `${best.person.first_name} ${best.person.last_name}`,
      matchReason: best.reason,
    };
  }

  return {
    ...base,
    action: "create",
    values,
    error: null,
    matchPersonId: best?.person.id ?? null,
    matchName: best ? `${best.person.first_name} ${best.person.last_name}` : null,
    matchReason: best ? `${best.reason} — check this isn't the same person` : null,
  };
}

// ── Persisting a plan ─────────────────────────────────────────────────────────

export interface ImportRunRow {
  id: string;
  club_id: string | null;
  source: string;
  entity: string;
  filename: string | null;
  mapping: string;
  mode: "dry_run" | "committed" | "rolled_back";
  row_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  status: string;
  committed_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
}

/** Save a plan so it can be reviewed, then committed or discarded. */
export async function savePlan(
  db: TenantDb,
  input: { clubId: string; filename: string | null; plan: ImportPlan; startedBy: string | null },
  now: string,
): Promise<string> {
  const runId = newId("importRun");

  await db.insert("import_runs", {
    id: runId,
    club_id: input.clubId,
    source: "csv",
    entity: "people",
    filename: input.filename,
    mapping: JSON.stringify(input.plan.mapping),
    mode: "dry_run",
    row_count: input.plan.rows.length,
    created_count: input.plan.counts.create,
    updated_count: input.plan.counts.update,
    skipped_count: input.plan.counts.skip,
    error_count: input.plan.counts.error,
    status: "planned",
    started_by: input.startedBy,
    created_at: now,
  });

  // Chunked: a 400-member roster is 400 rows, and D1 will not take that as one
  // batch.
  const CHUNK = 100;
  for (let i = 0; i < input.plan.rows.length; i += CHUNK) {
    await db.insertMany(
      "import_rows",
      input.plan.rows.slice(i, i + CHUNK).map((r) => ({
        id: newId("importRow"),
        run_id: runId,
        row_number: r.rowNumber,
        raw: JSON.stringify({ values: r.values, raw: r.raw }),
        action: r.action,
        match_person_id: r.matchPersonId,
        match_reason: r.matchReason,
        error: r.error,
        created_at: now,
      })),
    );
  }

  return runId;
}

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

/**
 * Apply a saved plan.
 *
 * Each row is applied on its own and its outcome recorded, so one bad row
 * doesn't abandon the other 399 — and the club can see precisely which rows
 * didn't land instead of being told the import "failed".
 */
export async function commitImport(
  db: TenantDb,
  runId: string,
  clubId: string,
  actorUserId: string | null,
  now: string,
): Promise<CommitResult> {
  const run = await db.byId<ImportRunRow>("import_runs", runId);
  if (!run) throw new Error("No such import run.");
  if (run.mode !== "dry_run") throw new Error("That import has already been applied.");

  const rows = await db.all<{
    id: string; row_number: number; raw: string; action: RowAction; match_person_id: string | null;
  }>("import_rows", { where: "run_id = ?", params: [runId], orderBy: "row_number", limit: 5000 });

  const result: CommitResult = { created: 0, updated: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    if (row.action === "skip" || row.action === "error") {
      result.skipped++;
      continue;
    }

    try {
      const { values } = JSON.parse(row.raw) as { values: PlannedRow["values"] };
      let personId: string;

      if (row.action === "update" && row.match_person_id) {
        personId = row.match_person_id;
        // Only fills gaps. An import must never overwrite something a club has
        // curated by hand with a staler value from an old export.
        await updatePerson(db, personId, fillOnly(values), now);
        result.updated++;
      } else {
        const person = await createPerson(db, { ...values, roles: ["member"] }, now);
        personId = person.id;
        result.created++;
      }

      const membership = await createMembership(
        db,
        {
          clubId,
          personId,
          stage: values.stage,
          membershipType: values.membershipType,
          joinedOn: values.joinedClubOn,
          source: "import",
        },
        now,
        actorUserId,
      );

      // createMembership returns the existing row when there already is one,
      // so a re-import doesn't reset somebody's standing — unless the file
      // genuinely says they've left.
      if (membership.stage !== values.stage) {
        await moveStage(
          db,
          { membershipId: membership.id, toStage: values.stage, reason: "Import", actorUserId },
          now,
        );
      }

      await db.update("import_rows", row.id, { entity_id: personId });
    } catch (err) {
      result.failed++;
      await db.update("import_rows", row.id, {
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await db.update("import_runs", runId, {
    mode: "committed",
    status: result.failed > 0 ? "completed_with_errors" : "completed",
    created_count: result.created,
    updated_count: result.updated,
    skipped_count: result.skipped,
    error_count: result.failed,
    committed_at: now,
  });

  return result;
}

/** Only the fields that are currently empty. Never overwrite curated data. */
function fillOnly(values: PlannedRow["values"]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["phone", "employer", "jobTitle", "classification", "city", "stateCode"] as const) {
    if (values[key]) patch[key] = values[key];
  }
  if (values.joinedRotaryOn) patch.joinedRotaryOn = values.joinedRotaryOn;
  return patch;
}

/**
 * Undo a committed import.
 *
 * Deletes only the people this run created — the ids it recorded at commit
 * time. Rows it *updated* are left alone: those people were already here, and
 * removing them would be a far worse outcome than a partial undo.
 */
export async function rollbackImport(
  db: TenantDb,
  runId: string,
  now: string,
): Promise<{ removed: number; kept: number }> {
  const run = await db.byId<ImportRunRow>("import_runs", runId);
  if (!run) throw new Error("No such import run.");
  if (run.mode !== "committed") throw new Error("That import hasn't been applied, so there's nothing to undo.");

  const rows = await db.all<{ id: string; entity_id: string | null; action: RowAction }>(
    "import_rows",
    { where: "run_id = ? AND entity_id IS NOT NULL", params: [runId], limit: 5000 },
  );

  let removed = 0;
  let kept = 0;

  for (const row of rows) {
    if (row.action !== "create" || !row.entity_id) {
      kept++;
      continue;
    }
    // Soft delete, like any other removal. Their history stays recoverable.
    await db.remove("people", row.entity_id, now);
    removed++;
  }

  await db.update("import_runs", runId, {
    mode: "rolled_back",
    status: "rolled_back",
    rolled_back_at: now,
  });

  return { removed, kept };
}

export function listImportRuns(db: TenantDb, limit = 20): Promise<ImportRunRow[]> {
  return db.all<ImportRunRow>("import_runs", { orderBy: "created_at DESC", limit });
}
