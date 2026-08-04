/**
 * documents.ts — the club's filing cabinet, and the reason it survives July.
 *
 * The thing this replaces is real and specific: the bylaws, the last three
 * years of minutes, the budget spreadsheet and the grant application somebody
 * spent a weekend on, all sitting in one outgoing secretary's email account.
 * Every July the new board starts from nothing and asks the same question —
 * "does anyone have a copy of…" — and half the time nobody does.
 *
 * Three properties make this more than an upload form:
 *
 *   **Every read is filtered by audience, in SQL.** Not in the loader, not in
 *   the component. `listDocuments` takes an `Audience` and there is no code
 *   path that returns a row the audience may not see, because the filter is in
 *   the WHERE clause rather than in a `.filter()` somebody can forget when
 *   they add a second call site.
 *
 *   **Uploading a new version supersedes rather than overwrites.** The old file
 *   stays, readable, linked. "What did it say before we amended it" gets asked
 *   at exactly the wrong moment, and a library that can't answer is a library
 *   that loses the argument.
 *
 *   **Deleting a document deletes the bytes too.** R2 objects that outlive
 *   their rows are a slow leak of both money and other people's information.
 *   `deleteDocument` takes the bucket for that reason, and a failure to remove
 *   the object is logged rather than swallowed.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";
import {
  constrainVisibility,
  documentKey,
  folderSlug,
  isAllowedType,
  isVisibility,
  MAX_DOCUMENT_BYTES,
  normaliseType,
  reachOf,
  rotaryYear,
  safeFilename,
  type Audience,
  type Visibility,
} from "@domain/documents";

export interface FolderRow {
  id: string;
  club_id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  visibility: Visibility;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  club_id: string;
  folder_id: string | null;
  title: string;
  description: string | null;
  r2_key: string;
  filename: string;
  content_type: string;
  bytes: number;
  visibility: Visibility;
  year_tag: string | null;
  version: number;
  supersedes_id: string | null;
  superseded_at: string | null;
  download_count: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A `?, ?, ?` list for the visibilities an audience may read.
 *
 * Built from `reachOf`, which returns values from a closed union, so nothing
 * caller-supplied reaches the SQL string — the values themselves are still
 * bound as parameters.
 */
function visibilityFilter(audience: Audience): { sql: string; params: string[] } {
  const reach = reachOf(audience);
  return { sql: reach.map(() => "?").join(", "), params: reach };
}

// ── Folders ───────────────────────────────────────────────────────────────────

export async function listFolders(
  db: TenantDb,
  clubId: string,
  audience: Audience = "board",
): Promise<FolderRow[]> {
  const v = visibilityFilter(audience);
  return db.all<FolderRow>("document_folders", {
    where: `club_id = ? AND visibility IN (${v.sql})`,
    params: [clubId, ...v.params],
    orderBy: "sort_order ASC, name ASC",
  });
}

export async function folderById(db: TenantDb, id: string): Promise<FolderRow | null> {
  return db.byId<FolderRow>("document_folders", id);
}

export async function folderBySlug(
  db: TenantDb,
  clubId: string,
  slug: string,
): Promise<FolderRow | null> {
  return db.first<FolderRow>("document_folders", {
    where: "club_id = ? AND slug = ?",
    params: [clubId, slug],
  });
}

export async function createFolder(
  db: TenantDb,
  input: {
    clubId: string;
    name: string;
    description?: string | null;
    parentId?: string | null;
    visibility?: Visibility;
    sortOrder?: number;
  },
  now: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, message: "A folder needs a name." };

  // A child folder can never be more open than its parent. Same rule as
  // documents, one level up, and for the same reason.
  let visibility: Visibility = isVisibility(input.visibility) ? input.visibility : "members";
  if (input.parentId) {
    const parent = await folderById(db, input.parentId);
    if (!parent) return { ok: false, message: "That parent folder no longer exists." };
    visibility = constrainVisibility(visibility, parent.visibility);
  }

  const id = newId("folder");
  const base = folderSlug(name);
  // Slugs are unique per club. Rather than let the insert fail on a constraint
  // and show the user a database error, take the collision and number it.
  const slug = await uniqueFolderSlug(db, input.clubId, base);

  await db.insert("document_folders", {
    id,
    club_id: input.clubId,
    name,
    slug,
    description: input.description?.trim().slice(0, 500) || null,
    parent_id: input.parentId ?? null,
    visibility,
    sort_order: input.sortOrder ?? 0,
    created_at: now,
    updated_at: now,
  });
  return { ok: true, id };
}

async function uniqueFolderSlug(db: TenantDb, clubId: string, base: string): Promise<string> {
  const taken = await db.all<{ slug: string }>("document_folders", {
    columns: "slug",
    where: "club_id = ? AND (slug = ? OR slug LIKE ?)",
    params: [clubId, base, `${base}-%`],
  });
  const set = new Set(taken.map((r) => r.slug));
  if (!set.has(base)) return base;
  for (let n = 2; n < 500; n++) {
    const candidate = `${base}-${n}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base}-${newId("folder").slice(-6)}`;
}

export async function updateFolder(
  db: TenantDb,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    visibility?: Visibility;
    sortOrder?: number;
  },
  now: string,
): Promise<{ ok: true; tightened: number } | { ok: false; message: string }> {
  const folder = await folderById(db, id);
  if (!folder) return { ok: false, message: "That folder no longer exists." };

  const values: Record<string, unknown> = { updated_at: now };
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 120);
    if (!name) return { ok: false, message: "A folder needs a name." };
    values.name = name;
  }
  if (patch.description !== undefined) {
    values.description = patch.description?.trim().slice(0, 500) || null;
  }
  if (patch.sortOrder !== undefined) values.sort_order = patch.sortOrder;

  let tightened = 0;
  if (patch.visibility !== undefined && isVisibility(patch.visibility)) {
    values.visibility = patch.visibility;
    // Restricting a folder must restrict what's already in it, immediately.
    // A folder that says "board" over a list of public documents is worse than
    // no setting at all, because it reads as protection that isn't there.
    tightened = await tightenFolderContents(db, id, patch.visibility, now);
  }

  await db.update("document_folders", id, values);
  return { ok: true, tightened };
}

/**
 * Pull every document in a folder up to at least the folder's visibility.
 *
 * Returns how many were changed so the caller can say so — "3 documents were
 * made board-only to match" is the sentence that stops this being a surprise.
 */
async function tightenFolderContents(
  db: TenantDb,
  folderId: string,
  visibility: Visibility,
  now: string,
): Promise<number> {
  const docs = await db.all<{ id: string; visibility: Visibility }>("documents", {
    columns: "id, visibility",
    where: "folder_id = ?",
    params: [folderId],
  });
  const wrong = docs.filter((d) => constrainVisibility(d.visibility, visibility) !== d.visibility);
  for (const d of wrong) {
    await db.update("documents", d.id, { visibility, updated_at: now });
  }
  return wrong.length;
}

/**
 * Delete a folder. Documents in it are moved out rather than destroyed.
 *
 * The schema has ON DELETE SET NULL on `documents.folder_id`, so this is really
 * about the visibility they carry: a document that was board-only because its
 * folder was board-only keeps that visibility on its own row, because it is
 * stored on the row and never inferred at read time. Deleting the folder must
 * not quietly publish its contents.
 */
export async function deleteFolder(db: TenantDb, id: string, now: string): Promise<number> {
  const children = await db.all<{ id: string }>("document_folders", {
    columns: "id",
    where: "parent_id = ?",
    params: [id],
  });
  for (const child of children) await db.update("document_folders", child.id, { parent_id: null, updated_at: now });
  return db.remove("document_folders", id, now);
}

// ── Documents ─────────────────────────────────────────────────────────────────

export interface DocumentQuery {
  clubId: string;
  audience: Audience;
  folderId?: string | null;
  yearTag?: string;
  /** Free text over title and description. */
  search?: string;
  /** Superseded versions are hidden unless asked for. */
  includeSuperseded?: boolean;
  limit?: number;
  offset?: number;
}

export async function listDocuments(db: TenantDb, q: DocumentQuery): Promise<DocumentRow[]> {
  const v = visibilityFilter(q.audience);
  const clauses = [`club_id = ?`, `visibility IN (${v.sql})`];
  const params: unknown[] = [q.clubId, ...v.params];

  if (!q.includeSuperseded) clauses.push("superseded_at IS NULL");
  if (q.folderId !== undefined) {
    if (q.folderId === null) clauses.push("folder_id IS NULL");
    else {
      clauses.push("folder_id = ?");
      params.push(q.folderId);
    }
  }
  if (q.yearTag) {
    clauses.push("year_tag = ?");
    params.push(q.yearTag);
  }
  if (q.search?.trim()) {
    const like = `%${q.search.trim().replace(/[%_]/g, "")}%`;
    clauses.push("(title LIKE ? OR description LIKE ? OR filename LIKE ?)");
    params.push(like, like, like);
  }

  return db.all<DocumentRow>("documents", {
    where: clauses.join(" AND "),
    params,
    orderBy: "created_at DESC",
    limit: q.limit ?? 200,
    offset: q.offset,
  });
}

/**
 * One document, but only if this audience may see it.
 *
 * Takes the audience rather than returning the row and leaving the check to the
 * caller. A `documentById` that returns board minutes to anyone who knows the
 * id is a leak with a plausible-looking call site, and there would eventually
 * be a call site that forgot.
 */
export async function documentFor(
  db: TenantDb,
  id: string,
  audience: Audience,
): Promise<DocumentRow | null> {
  const v = visibilityFilter(audience);
  return db.first<DocumentRow>("documents", {
    where: `id = ? AND visibility IN (${v.sql})`,
    params: [id, ...v.params],
  });
}

/** For the library's own admin screens, where the capability was already checked. */
export async function documentById(db: TenantDb, id: string): Promise<DocumentRow | null> {
  return db.byId<DocumentRow>("documents", id);
}

export interface UploadInput {
  clubId: string;
  title: string;
  filename: string;
  contentType: string;
  bytes: number;
  description?: string | null;
  folderId?: string | null;
  visibility?: Visibility;
  yearTag?: string | null;
  /** The document this replaces, if it's a new version of something. */
  supersedesId?: string | null;
  uploadedBy?: string | null;
}

export type UploadPlan =
  | {
      ok: true;
      id: string;
      r2Key: string;
      filename: string;
      contentType: string;
      visibility: Visibility;
      /** True when the folder forced a narrower visibility than was asked for. */
      narrowed: boolean;
    }
  | { ok: false; message: string };

/**
 * Validate an upload and decide where it goes — without writing anything.
 *
 * Split from `recordDocument` on purpose. The bytes have to reach R2 before the
 * row is worth writing, and a row pointing at an object that failed to upload
 * is a broken download link in a list of working ones, which is the worst of
 * both outcomes. So: plan, put, record. If the put fails, nothing was written.
 */
export function planUpload(
  db: TenantDb,
  input: UploadInput,
  // Only the visibility matters here, so that is all it asks for — a caller
  // that has just read the folder id off a form shouldn't have to fetch the
  // whole row to find out whether the upload is allowed.
  folder: { visibility: Visibility } | null,
): UploadPlan {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, message: "Give the document a name people will recognise." };

  const contentType = normaliseType(input.contentType);
  if (!isAllowedType(contentType)) {
    return {
      ok: false,
      message: `Sodalitas doesn't accept ${contentType || "that kind of file"}. PDFs, Office documents, images, and plain text are fine.`,
    };
  }
  if (input.bytes <= 0) return { ok: false, message: "That file appears to be empty." };
  if (input.bytes > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      message: `Files are limited to ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB. Split it, or link to it instead.`,
    };
  }

  const wanted: Visibility = isVisibility(input.visibility) ? input.visibility : "members";
  const visibility = constrainVisibility(wanted, folder?.visibility ?? null);

  const id = newId("document");
  const filename = safeFilename(input.filename);
  return {
    ok: true,
    id,
    r2Key: documentKey(db.tenantId, input.clubId, id, filename),
    filename,
    contentType,
    visibility,
    narrowed: visibility !== wanted,
  };
}

/**
 * Write the row for an object already in R2, and retire what it supersedes.
 *
 * The version number is taken from the document being replaced rather than
 * counted, so a chain stays monotonic even if an intermediate version was
 * deleted.
 */
export async function recordDocument(
  db: TenantDb,
  plan: Extract<UploadPlan, { ok: true }>,
  input: UploadInput,
  now: string,
): Promise<string> {
  let version = 1;
  let supersedesId: string | null = null;

  if (input.supersedesId) {
    const previous = await documentById(db, input.supersedesId);
    if (previous && previous.club_id === input.clubId) {
      supersedesId = previous.id;
      version = previous.version + 1;
    }
  }

  await db.insert("documents", {
    id: plan.id,
    club_id: input.clubId,
    folder_id: input.folderId ?? null,
    title: input.title.trim().slice(0, 200),
    description: input.description?.trim().slice(0, 1000) || null,
    r2_key: plan.r2Key,
    filename: plan.filename,
    content_type: plan.contentType,
    bytes: input.bytes,
    visibility: plan.visibility,
    year_tag: input.yearTag?.trim() || rotaryYear(now),
    version,
    supersedes_id: supersedesId,
    superseded_at: null,
    download_count: 0,
    uploaded_by: input.uploadedBy ?? null,
    created_at: now,
    updated_at: now,
  });

  // Retire the previous version only once the new row exists. The other order
  // leaves a club with nothing visible if the insert fails.
  if (supersedesId) {
    await db.update("documents", supersedesId, { superseded_at: now, updated_at: now });
  }

  return plan.id;
}

export async function updateDocument(
  db: TenantDb,
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    folderId?: string | null;
    visibility?: Visibility;
    yearTag?: string | null;
  },
  now: string,
): Promise<{ ok: true; narrowed: boolean } | { ok: false; message: string }> {
  const doc = await documentById(db, id);
  if (!doc) return { ok: false, message: "That document no longer exists." };

  const values: Record<string, unknown> = { updated_at: now };
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 200);
    if (!title) return { ok: false, message: "A document needs a name." };
    values.title = title;
  }
  if (patch.description !== undefined) {
    values.description = patch.description?.trim().slice(0, 1000) || null;
  }
  if (patch.yearTag !== undefined) values.year_tag = patch.yearTag?.trim() || null;

  // Moving a document and changing its visibility are the same decision, so
  // they are resolved together: the destination folder's floor applies whether
  // the folder changed, the visibility changed, or both.
  const folderId = patch.folderId !== undefined ? patch.folderId : doc.folder_id;
  if (patch.folderId !== undefined) values.folder_id = folderId;

  const wanted: Visibility =
    patch.visibility !== undefined && isVisibility(patch.visibility) ? patch.visibility : doc.visibility;
  const folder = folderId ? await folderById(db, folderId) : null;
  const visibility = constrainVisibility(wanted, folder?.visibility ?? null);
  values.visibility = visibility;

  await db.update("documents", id, values);
  return { ok: true, narrowed: visibility !== wanted };
}

/**
 * Delete a document and its bytes.
 *
 * The row goes first: a row without an object is a broken link, an object
 * without a row is somebody's board minutes sitting in a bucket forever. If the
 * bucket delete fails the key is returned so a caller — or the nightly cron —
 * can try again, rather than the failure vanishing into a log line.
 */
export async function deleteDocument(
  db: TenantDb,
  id: string,
  bucket: R2Bucket | undefined,
  now: string,
): Promise<{ deleted: boolean; orphanedKey?: string }> {
  const doc = await documentById(db, id);
  if (!doc) return { deleted: false };

  // Anything that pointed at this as its previous version now points at
  // nothing; the schema's SET NULL handles the column, but the version chain
  // is only useful if the successor stays readable, which it does.
  await db.remove("documents", id, now);

  if (!bucket) return { deleted: true, orphanedKey: doc.r2_key };
  try {
    await bucket.delete(doc.r2_key);
    return { deleted: true };
  } catch (err) {
    console.error("[documents] row removed but R2 object remains", doc.r2_key, err);
    return { deleted: true, orphanedKey: doc.r2_key };
  }
}

/**
 * Note that somebody downloaded it.
 *
 * Best-effort and deliberately not awaited by the download path — a counter
 * that fails must never be the reason a club can't open its own bylaws.
 */
export async function noteDownload(db: TenantDb, id: string): Promise<void> {
  try {
    await db.raw(
      `UPDATE documents SET download_count = download_count + 1
        WHERE tenant_id = {{tenant}} AND id = ?`,
      [id],
    );
  } catch (err) {
    console.error("[documents] download counter failed", err);
  }
}

/** The chain of previous versions, newest first. Stops at 20 to bound a cycle. */
export async function versionHistory(db: TenantDb, id: string): Promise<DocumentRow[]> {
  const chain: DocumentRow[] = [];
  const seen = new Set<string>([id]);
  let cursor = await documentById(db, id);

  while (cursor?.supersedes_id && chain.length < 20) {
    if (seen.has(cursor.supersedes_id)) break;
    seen.add(cursor.supersedes_id);
    const previous = await documentById(db, cursor.supersedes_id);
    if (!previous) break;
    chain.push(previous);
    cursor = previous;
  }
  return chain;
}

// ── Summaries ─────────────────────────────────────────────────────────────────

export interface LibrarySummary {
  documents: number;
  bytes: number;
  folders: number;
  /** Rotary years that actually have something filed against them, newest first. */
  years: string[];
}

export async function librarySummary(
  db: TenantDb,
  clubId: string,
  audience: Audience,
): Promise<LibrarySummary> {
  const v = visibilityFilter(audience);
  const [totals, years, folders] = await Promise.all([
    db.raw<{ n: number; bytes: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes
         FROM documents
        WHERE tenant_id = {{tenant}} AND club_id = ?
          AND superseded_at IS NULL AND visibility IN (${v.sql})`,
      [clubId, ...v.params],
    ),
    db.raw<{ year_tag: string }>(
      `SELECT DISTINCT year_tag FROM documents
        WHERE tenant_id = {{tenant}} AND club_id = ?
          AND year_tag IS NOT NULL AND superseded_at IS NULL AND visibility IN (${v.sql})
        ORDER BY year_tag DESC`,
      [clubId, ...v.params],
    ),
    db.count("document_folders", {
      where: `club_id = ? AND visibility IN (${v.sql})`,
      params: [clubId, ...v.params],
    }),
  ]);

  return {
    documents: totals[0]?.n ?? 0,
    bytes: totals[0]?.bytes ?? 0,
    folders,
    years: years.map((y) => y.year_tag),
  };
}

/**
 * The folders a new club starts with.
 *
 * Not a blank library. A club that opens an empty page files nothing; a club
 * that opens "Minutes / Bylaws / Budgets / Grants / Photos" files the minutes
 * that week. The visibilities are the ones a Rotary club actually wants and are
 * the part most likely to be got wrong by hand — Governance public because the
 * bylaws usually are, Board private because the minutes always are.
 */
export const STARTER_FOLDERS: Array<{
  name: string;
  slug: string;
  description: string;
  visibility: Visibility;
}> = [
  {
    name: "Governance",
    slug: "governance",
    description: "Bylaws, the constitution, and the club's standing policies.",
    visibility: "public",
  },
  {
    name: "Board",
    slug: "board",
    description: "Board minutes, agendas, and papers.",
    visibility: "board",
  },
  {
    name: "Meetings",
    slug: "meetings",
    description: "Weekly agendas, speaker notes, and club assembly papers.",
    visibility: "members",
  },
  {
    name: "Finance",
    slug: "finance",
    description: "Budgets, annual accounts, and the treasurer's reports.",
    visibility: "board",
  },
  {
    name: "Projects and grants",
    slug: "projects-and-grants",
    description: "Grant applications, project reports, and acquittals.",
    visibility: "members",
  },
  {
    name: "Forms",
    slug: "forms",
    description: "Membership forms, expense claims, and anything people ask for twice.",
    visibility: "public",
  },
];

/** Create the starter folders for a club that has none. Idempotent. */
export async function seedFolders(db: TenantDb, clubId: string, now: string): Promise<number> {
  const existing = await db.count("document_folders", { where: "club_id = ?", params: [clubId] });
  if (existing > 0) return 0;

  await db.insertMany(
    "document_folders",
    STARTER_FOLDERS.map((f, i) => ({
      id: newId("folder"),
      club_id: clubId,
      name: f.name,
      slug: f.slug,
      description: f.description,
      parent_id: null,
      visibility: f.visibility,
      sort_order: i,
      created_at: now,
      updated_at: now,
    })),
  );
  return STARTER_FOLDERS.length;
}
