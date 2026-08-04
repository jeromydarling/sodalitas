/**
 * documents.ts — who may see a file, and what a file is allowed to be.
 *
 * The library's whole value is that a club stops losing its own paperwork every
 * July. That only holds if two questions have boring, provable answers:
 *
 *   **Who can see this?** Three audiences, one ladder: public < members <
 *   board. Every read is filtered by the *lowest* rung the viewer stands on,
 *   and a folder can only ever narrow what it contains, never widen it. The
 *   failure this prevents is specific and awful: the board minutes appearing on
 *   the club's public website because somebody moved a file and nobody checked.
 *
 *   **What can be uploaded?** An allowlist of document types, a size ceiling,
 *   and a filename that has been through `safeFilename` before it reaches R2 or
 *   a Content-Disposition header. A club secretary uploading `../../etc/passwd`
 *   is not the threat; a club secretary uploading a file whose name contains a
 *   quote and a newline, on a Friday, is.
 *
 * Everything here is pure. The service layer decides *when*; this file decides
 * *whether*, and it can be tested without a database.
 */

// The Rotary year is the unit of club memory for documents exactly as it is
// for events, so it is imported rather than re-derived. Two implementations
// that must agree is a bug waiting for a July.
import { rotaryYear } from "./events";

export { rotaryYear };

export const DOCUMENT_VISIBILITIES = ["public", "members", "board"] as const;
export type Visibility = (typeof DOCUMENT_VISIBILITIES)[number];

export function isVisibility(v: unknown): v is Visibility {
  return typeof v === "string" && (DOCUMENT_VISIBILITIES as readonly string[]).includes(v);
}

/**
 * Who is asking. Deliberately not the same vocabulary as `Visibility` — an
 * audience is a property of the reader, a visibility is a property of the file,
 * and collapsing the two is how "public" ends up meaning two different things
 * in two different functions.
 */
export type Audience = "public" | "member" | "board";

const AUDIENCE_REACH: Record<Audience, Visibility[]> = {
  public: ["public"],
  member: ["public", "members"],
  board: ["public", "members", "board"],
};

/** The visibilities this audience may read. Safe to splice into a SQL `IN`. */
export function reachOf(audience: Audience): Visibility[] {
  return AUDIENCE_REACH[audience] ?? AUDIENCE_REACH.public;
}

export function canSee(visibility: Visibility, audience: Audience): boolean {
  return reachOf(audience).includes(visibility);
}

/**
 * What audience a viewer stands in, from what they hold.
 *
 * Signed out is `public` — not "members, because they're probably a member".
 * The club site renders through this same function, and a wrong guess here is
 * a leak rather than an inconvenience.
 */
export function audienceFor(opts: { signedIn: boolean; boardAccess: boolean }): Audience {
  if (opts.boardAccess) return "board";
  return opts.signedIn ? "member" : "public";
}

const RANK: Record<Visibility, number> = { public: 0, members: 1, board: 2 };

/**
 * A folder is a floor, not a ceiling.
 *
 * A folder marked `board` may not contain a `public` document; asking for one
 * gets `board` back. The reverse is fine — a `public` folder can hold a
 * document somebody deliberately restricted, because narrowing is always safe
 * and widening never is. Returns the visibility that will actually be stored,
 * so a caller can tell the user it was changed rather than silently disagree
 * with the form they just submitted.
 */
export function constrainVisibility(
  wanted: Visibility,
  folder: Visibility | null | undefined,
): Visibility {
  if (!folder) return wanted;
  return RANK[wanted] >= RANK[folder] ? wanted : folder;
}

// ── Files ─────────────────────────────────────────────────────────────────────

/**
 * What a club may put in the library.
 *
 * Anything executable, and anything a browser will happily run in the origin's
 * own context, is absent on purpose — `text/html` most of all, because a
 * document served from the club's own domain is a stored XSS with a filename.
 * The list is what a club actually uploads: agendas, minutes, budgets, grant
 * applications, flyers, spreadsheets, and photographs of a cheque.
 */
export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/rtf": "rtf",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/calendar": "ics",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/zip": "zip",
};

export function isAllowedType(contentType: string): boolean {
  return normaliseType(contentType) in ALLOWED_DOCUMENT_TYPES;
}

/** Strip the `; charset=` tail and case, which browsers vary on. */
export function normaliseType(contentType: string): string {
  return contentType.split(";")[0]!.trim().toLowerCase();
}

/** 25MB. A scanned set of minutes is 2–5; a year of board packets is not one file. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * A filename safe to store, to log, and to put in a Content-Disposition header.
 *
 * Path separators and control characters are removed rather than replaced, the
 * result is capped, and an empty result becomes `document` — never the empty
 * string, which produces a header a browser interprets as it pleases.
 */
export function safeFilename(input: string): string {
  const base = input.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["'`<>|?*:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "document";
}

/** The extension actually on the file, lowercased, or null. */
export function extensionOf(filename: string): string | null {
  const m = /\.([a-z0-9]{1,8})$/i.exec(filename);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Where the bytes live. Tenant-first so a mis-scoped R2 `list()` cannot walk
 * from one club's library into another's, and the document id rather than the
 * filename so two uploads called `minutes.pdf` never collide.
 */
export function documentKey(
  tenantId: string,
  clubId: string,
  documentId: string,
  filename: string,
): string {
  const ext = extensionOf(filename) ?? "bin";
  return `documents/${tenantId}/${clubId}/${documentId}.${ext}`;
}

// ── Naming ────────────────────────────────────────────────────────────────────

export function folderSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "folder";
}

/** Every Rotary year from the club's charter to now, newest first. */
export function rotaryYearsSince(from: string, today: string): string[] {
  const first = rotaryYear(from);
  const last = rotaryYear(today);
  if (!first || !last) return [];
  const start = Number(first.slice(0, 4));
  const end = Number(last.slice(0, 4));
  if (end < start) return [last];
  const years: string[] = [];
  for (let y = end; y >= start; y--) years.push(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
  return years;
}

/** Bytes as a club secretary would say them. */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
