/**
 * documents.tsx — the club's filing cabinet.
 *
 * One page rather than a folder tree with its own navigation. A club has forty
 * documents, not four thousand, and a tree would be four clicks deep on a
 * library that fits on one screen. Folders are a filter here, not a place.
 *
 * The visibility of every document is on the row, always, in words. A library
 * where you have to open a file to find out who can read it is a library where
 * the minutes end up on the website.
 */

import { Form, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/documents";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import {
  createFolder,
  deleteDocument,
  librarySummary,
  listDocuments,
  listFolders,
  planUpload,
  recordDocument,
  seedFolders,
  updateDocument,
} from "@db/services/documents";
import {
  audienceFor,
  humanBytes,
  isVisibility,
  MAX_DOCUMENT_BYTES,
  rotaryYear,
  type Visibility,
} from "@domain/documents";
import {
  Button,
  Card,
  Chip,
  Empty,
  Field,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  formatDate,
} from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Documents");
}

const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: "Anyone",
  members: "Members",
  board: "Board",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("documents.read");
  const db = ctx.db();

  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return null;

  // The audience is derived from what this user actually holds, not from the
  // fact they're signed in. A member without the board capability sees the
  // members' library and cannot tell the board folder exists.
  const audience = audienceFor({
    signedIn: true,
    boardAccess: ctx.can("documents.read_board", club.id),
  });

  const canWrite = ctx.can("documents.write", club.id);
  if (canWrite) await seedFolders(db, club.id, ctx.now);

  const url = new URL(request.url);
  const folderId = url.searchParams.get("folder");
  const yearTag = url.searchParams.get("year") ?? undefined;
  const search = url.searchParams.get("q") ?? undefined;

  const [folders, documents, summary] = await Promise.all([
    listFolders(db, club.id, audience),
    listDocuments(db, {
      clubId: club.id,
      audience,
      folderId: folderId ? folderId : undefined,
      yearTag,
      search,
      limit: 300,
    }),
    librarySummary(db, club.id, audience),
  ]);

  const folderNames = new Map(folders.map((f) => [f.id, f.name]));

  return {
    audience,
    canWrite,
    thisYear: rotaryYear(ctx.today),
    summary,
    filters: { folderId, yearTag: yearTag ?? null, search: search ?? null },
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      visibility: f.visibility,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      filename: d.filename,
      bytes: d.bytes,
      size: humanBytes(d.bytes),
      visibility: d.visibility,
      yearTag: d.year_tag,
      version: d.version,
      folder: d.folder_id ? (folderNames.get(d.folder_id) ?? null) : null,
      folderId: d.folder_id,
      createdAt: d.created_at,
      downloads: d.download_count,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  const db = ctx.db();
  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };
  ctx.require("documents.write", club.id);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "newFolder") {
    const result = await createFolder(
      db,
      {
        clubId: club.id,
        name: String(form.get("name") ?? ""),
        visibility: visibilityFrom(form.get("visibility")),
      },
      ctx.now,
    );
    return result.ok ? { ok: true, message: "Folder added." } : { error: result.message };
  }

  if (intent === "move") {
    const result = await updateDocument(
      db,
      String(form.get("documentId") ?? ""),
      {
        folderId: String(form.get("folderId") ?? "") || null,
        visibility: visibilityFrom(form.get("visibility")),
      },
      ctx.now,
    );
    if (!result.ok) return { error: result.message };
    return {
      ok: true,
      message: result.narrowed
        ? "Saved — the folder it's in is more restricted, so it took the folder's setting."
        : "Saved.",
    };
  }

  if (intent === "delete") {
    const result = await deleteDocument(
      db,
      String(form.get("documentId") ?? ""),
      ctx.env.R2,
      ctx.now,
    );
    if (!result.deleted) return { error: "That document has already gone." };
    return { ok: true, message: "Deleted." };
  }

  if (intent === "upload") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a file to upload." };
    }

    const folderId = String(form.get("folderId") ?? "") || null;
    const folder = folderId
      ? await db.byId<{ id: string; visibility: Visibility }>("document_folders", folderId)
      : null;

    const input = {
      clubId: club.id,
      title: String(form.get("title") ?? "").trim() || file.name,
      filename: file.name,
      contentType: file.type,
      bytes: file.size,
      description: String(form.get("description") ?? ""),
      folderId,
      visibility: visibilityFrom(form.get("visibility")),
      yearTag: String(form.get("yearTag") ?? "") || null,
      supersedesId: String(form.get("supersedesId") ?? "") || null,
      uploadedBy: ctx.user?.id ?? null,
    };

    const plan = planUpload(db, input, folder);
    if (!plan.ok) return { error: plan.message };

    // Bytes first. A row pointing at an object that never arrived is a broken
    // download sitting in a list of working ones.
    await ctx.env.R2.put(plan.r2Key, file.stream(), {
      httpMetadata: {
        contentType: plan.contentType,
        // Always an attachment. Nothing in this library should ever render in
        // the club's own origin, whatever its declared type turns out to be.
        contentDisposition: `attachment; filename="${plan.filename}"`,
      },
    });

    await recordDocument(db, plan, input, ctx.now);

    return {
      ok: true,
      message: plan.narrowed
        ? `Uploaded — the folder it's in is more restricted, so it's ${VISIBILITY_LABEL[plan.visibility].toLowerCase()} only.`
        : "Uploaded.",
    };
  }

  return { error: "We didn't recognise that." };
}

function visibilityFrom(value: FormDataEntryValue | null): Visibility {
  const v = String(value ?? "");
  return isVisibility(v) ? v : "members";
}

export default function Documents({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [params, setParams] = useSearchParams();

  if (!loaderData) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Empty title="No club yet" body="This account isn't attached to a club." />
      </div>
    );
  }

  const { folders, documents, summary, canWrite, filters, thisYear, audience } = loaderData;

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { preventScrollReset: true });
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Documents"
        subtitle="Bylaws, minutes, budgets and everything the next board will need. In one place that isn't somebody's email."
      />

      {actionData?.error && (
        <p className="mb-6 rounded-lg bg-risk-50 px-4 py-3 text-sm text-risk-600 dark:bg-risk-900/20">
          {actionData.error}
        </p>
      )}
      {actionData?.ok && actionData.message && (
        <p className="mb-6 rounded-lg bg-steady-50 px-4 py-3 text-sm text-steady-600 dark:bg-steady-900/20">
          {actionData.message}
        </p>
      )}

      {canWrite && (
        <Card className="mb-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">Add a document</h2>
          <Form method="post" encType="multipart/form-data" className="mt-4 grid gap-4 sm:grid-cols-6">
            <input type="hidden" name="intent" value="upload" />
            <div className="sm:col-span-3">
              <Field label="File" name="file" hint={`Up to ${humanBytes(MAX_DOCUMENT_BYTES)}`}>
                <Input id="file" name="file" type="file" required />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="What to call it" name="title" hint="Blank uses the filename">
                <Input id="title" name="title" placeholder="Board minutes — March" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Folder" name="folderId">
                <Select id="folderId" name="folderId" defaultValue={filters.folderId ?? ""}>
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Who can read it" name="visibility">
                <Select id="visibility" name="visibility" defaultValue="members">
                  <option value="public">Anyone — can appear on the club's website</option>
                  <option value="members">Members</option>
                  <option value="board">Board only</option>
                </Select>
              </Field>
            </div>
            <div className="sm:col-span-1">
              <Field label="Rotary year" name="yearTag">
                <Input id="yearTag" name="yearTag" defaultValue={thisYear} />
              </Field>
            </div>
            <div className="flex items-end sm:col-span-1">
              <Button type="submit" disabled={busy} className="w-full">
                Upload
              </Button>
            </div>
          </Form>
          <p className="mt-3 text-xs text-ink-500">
            A folder's setting is a floor: putting a document in the board folder makes it
            board-only, whatever you pick here.
          </p>
        </Card>
      )}

      {/* ── Filters ── */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <FilterChip
          label="Everything"
          active={!filters.folderId}
          onClick={() => setFilter("folder", "")}
        />
        {folders.map((f) => (
          <FilterChip
            key={f.id}
            label={f.name}
            hint={VISIBILITY_LABEL[f.visibility]}
            active={filters.folderId === f.id}
            onClick={() => setFilter("folder", f.id)}
          />
        ))}
        {summary.years.length > 1 && (
          <select
            value={filters.yearTag ?? ""}
            onChange={(e) => setFilter("year", e.target.value)}
            className="rounded-full border border-ink-300 bg-white px-3 py-1 text-sm text-ink-700 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300"
            aria-label="Rotary year"
          >
            <option value="">Every year</option>
            {summary.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
      </div>

      {documents.length === 0 ? (
        <Empty
          title={filters.folderId || filters.yearTag ? "Nothing filed here" : "The cabinet is empty"}
          body={
            canWrite
              ? "Start with the bylaws and the last set of minutes. Those are the two the next board asks for."
              : "Nothing has been filed that you can see yet."
          }
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th className="hidden sm:table-cell">Filed</Th>
                <Th>Who can read it</Th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <a
                      href={`/app/documents/${d.id}`}
                      className="font-medium text-ink-900 hover:text-brand-600 dark:text-ink-100"
                    >
                      {d.title}
                    </a>
                    <div className="text-xs text-ink-500">
                      {[d.filename, d.size, d.version > 1 ? `v${d.version}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </Td>
                  <Td className="hidden text-ink-600 sm:table-cell dark:text-ink-400">
                    {formatDate(d.createdAt.slice(0, 10))}
                    <div className="text-xs text-ink-500">
                      {[d.folder, d.yearTag].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Chip tone={d.visibility === "public" ? "steady" : d.visibility === "board" ? "risk" : "neutral"}>
                        {VISIBILITY_LABEL[d.visibility]}
                      </Chip>
                      {canWrite && (
                        <Form method="post">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="documentId" value={d.id} />
                          <button
                            type="submit"
                            disabled={busy}
                            className="text-xs text-ink-500 underline-offset-2 hover:text-risk-500 hover:underline"
                          >
                            delete
                          </button>
                        </Form>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <p className="mt-4 text-xs text-ink-500">
            {summary.documents} document{summary.documents === 1 ? "" : "s"}, {humanBytes(summary.bytes)}
            {audience !== "board" && " that you can see"}.
          </p>
        </>
      )}

      {canWrite && (
        <Card className="mt-8">
          <h2 className="font-medium text-ink-900 dark:text-ink-100">New folder</h2>
          <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-4">
            <input type="hidden" name="intent" value="newFolder" />
            <div className="sm:col-span-2">
              <Field label="Name" name="name">
                <Input id="name" name="name" placeholder="Newsletters" required />
              </Field>
            </div>
            <Field label="Who can read it" name="visibility">
              <Select id="folderVisibility" name="visibility" defaultValue="members">
                <option value="public">Anyone</option>
                <option value="members">Members</option>
                <option value="board">Board only</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={busy} className="w-full">
                Add
              </Button>
            </div>
          </Form>
        </Card>
      )}
    </div>
  );
}

function FilterChip({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-brand-600 px-3 py-1 text-sm font-medium text-white"
          : "rounded-full border border-ink-300 px-3 py-1 text-sm text-ink-700 hover:border-brand-400 dark:border-ink-700 dark:text-ink-300"
      }
    >
      {label}
      {hint && !active && <span className="ml-1.5 text-xs text-ink-400">{hint}</span>}
    </button>
  );
}
