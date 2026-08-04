import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/site-page";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext, requireNotDemo } from "@worker/context";
import {
  siteFor, pageById, savePage, publishPage, unpublishPage, listPages,
  listMedia, listVersions, saveProposal, restoreVersion, activeTokens,
} from "@db/services/sites";
import {
  BLOCKS, BLOCK_TYPES, parseBlocks, serialiseBlocks,
  type Block, type BlockDef, type FieldSpec,
} from "@domain/blocks";
import {
  blockFromForm, replaceBlock, addBlock, removeBlock, moveBlock,
  fieldName, itemFieldName, LIST_ROWS,
} from "@domain/blockForm";
import { proposePage, type ClubFacts } from "@ai/site";
import { isConfigured } from "@ai/provider";
import { PageHeader, Card, Chip, Button, Field, Input, Select, Textarea, formatDate } from "~/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return appMeta(loaderData?.page.title ?? "Page");
}

// ── Facts ─────────────────────────────────────────────────────────────────────

/**
 * Everything the drafting prompt is allowed to know about this club.
 *
 * Assembled here rather than in the AI module so the boundary is visible at the
 * call site: these five queries are the complete list of what leaves the
 * database for a model, and there is no roster query among them.
 */
async function gatherFacts(
  db: ReturnType<Awaited<ReturnType<typeof getContext>>["db"]>,
  club: { id: string; name: string; city: string | null; state_code: string | null; charter_date: string | null; meeting_blurb: string | null; public_blurb: string | null },
): Promise<ClubFacts> {
  const [projects, series, memberCount] = await Promise.all([
    db.all<{ name: string; area_of_focus: string | null; summary: string | null }>("projects", {
      columns: "name, area_of_focus, summary",
      where: "club_id = ? AND is_public = 1",
      params: [club.id],
      orderBy: "starts_on DESC",
      limit: 10,
    }),
    db.first<{ rrule_weekday: number; start_time: string; location: string | null }>("meeting_series", {
      columns: "rrule_weekday, start_time, location",
      where: "club_id = ? AND active = 1",
      params: [club.id],
    }),
    db.count("memberships", {
      where: "club_id = ? AND stage IN ('active','at_risk','leave_of_absence')",
      params: [club.id],
    }),
  ]);

  const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

  return {
    name: club.name,
    city: club.city,
    stateCode: club.state_code,
    charterYear: club.charter_date ? club.charter_date.slice(0, 4) : null,
    meets: series ? `${DAYS[series.rrule_weekday] ?? "Weekly"} at ${series.start_time}` : club.meeting_blurb,
    location: series?.location ?? null,
    projects: projects.map((p) => ({ name: p.name, area: p.area_of_focus, summary: p.summary })),
    // The only figure we volunteer, and it comes from a count of real rows.
    // Everything else the model would like, it has to leave blank.
    figures: memberCount > 0 ? [{ label: "members", value: String(memberCount) }] : [],
    notes: club.public_blurb,
  };
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.edit");
  const db = ctx.db();

  const club = await db.first<{ id: string; name: string; slug: string }>("clubs", {
    columns: "id, name, slug",
  });
  if (!club) throw new Response("This account has no club yet.", { status: 404 });

  const site = await siteFor(db, club.id);
  if (!site) throw new Response("No site yet.", { status: 404 });

  const page = await pageById(db, params.pageId);
  if (!page || page.site_id !== site.id) {
    throw new Response("No page at that address.", { status: 404 });
  }

  const [pages, media, versions, tokens] = await Promise.all([
    listPages(db, site.id),
    listMedia(db, club.id, 60),
    listVersions(db, page.id, 12),
    activeTokens(db, site),
  ]);

  return {
    club,
    site: { id: site.id, status: site.status, homePageId: site.home_page_id },
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      navLabel: page.nav_label,
      description: page.description,
      status: page.status,
      showInNav: page.show_in_nav === 1,
      noindex: page.noindex === 1,
      scheduledFor: page.scheduled_for,
      isHome: page.id === site.home_page_id,
    },
    blocks: parseBlocks(page.blocks_json),
    otherPages: pages.filter((p) => p.id !== page.id).map((p) => ({ slug: p.slug, title: p.title })),
    media: media.map((m) => ({ id: m.id, filename: m.filename, alt: m.alt_text })),
    versions: versions.map((v) => ({
      id: v.id,
      kind: v.kind,
      label: v.label,
      createdAt: v.created_at,
      sections: parseBlocks(v.blocks_json).length,
    })),
    tokens,
    canPublish: ctx.can("site.publish"),
    aiReady: isConfigured(ctx.env),
    previewBase: `/club/${club.slug}`,
  };
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ params, request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.edit");
  const db = ctx.db();

  const club = await db.first<{
    id: string; name: string; city: string | null; state_code: string | null;
    charter_date: string | null; meeting_blurb: string | null; public_blurb: string | null;
  }>("clubs", {
    columns: "id, name, city, state_code, charter_date, meeting_blurb, public_blurb",
  });
  if (!club) return { error: "This account has no club yet." };

  const site = await siteFor(db, club.id);
  const page = site ? await pageById(db, params.pageId) : null;
  if (!site || !page || page.site_id !== site.id) return { error: "We couldn't find that page." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const blocks = parseBlocks(page.blocks_json);
  const userId = ctx.user?.id ?? null;

  const write = async (next: Block[]) => {
    const result = await savePage(db, page, { blocks: next }, ctx.now, userId);
    return { ok: true as const, notes: result.notes.map((n) => n.message) };
  };

  switch (intent) {
    case "block-save": {
      const id = String(form.get("blockId") ?? "");
      const type = String(form.get("blockType") ?? "");
      const next = blockFromForm(type, id, form);
      if (!next) return { error: "We didn't recognise that section." };
      return write(replaceBlock(blocks, id, next));
    }

    case "block-add":
      return write(addBlock(blocks, String(form.get("blockType") ?? "")));

    case "block-remove":
      return write(removeBlock(blocks, String(form.get("blockId") ?? "")));

    case "block-up":
      return write(moveBlock(blocks, String(form.get("blockId") ?? ""), -1));

    case "block-down":
      return write(moveBlock(blocks, String(form.get("blockId") ?? ""), 1));

    case "page-settings": {
      const scheduled = String(form.get("scheduledFor") ?? "").trim();
      const result = await savePage(
        db,
        page,
        {
          title: String(form.get("title") ?? ""),
          navLabel: String(form.get("navLabel") ?? "") || null,
          description: String(form.get("description") ?? "") || null,
          slug: String(form.get("slug") ?? ""),
          showInNav: form.get("showInNav") === "on",
          noindex: form.get("noindex") === "on",
          // <input type="datetime-local"> gives "2026-08-12T20:00" with no
          // zone. Treated as UTC rather than guessed at: a club that means 8pm
          // local and gets 8pm UTC has a page appear a few hours early, which
          // is recoverable; a club whose page never appears is not.
          scheduledFor: scheduled ? `${scheduled}:00.000Z`.replace(/:\d\d:00\.000Z$/, ":00.000Z") : null,
        },
        ctx.now,
        userId,
      );
      return { ok: true as const, notes: result.notes.map((n) => n.message) };
    }

    case "publish":
      ctx.require("site.publish");
      await publishPage(db, page, ctx.now, userId);
      return { ok: true as const, notes: [] };

    case "unpublish":
      ctx.require("site.publish");
      await unpublishPage(db, page.id, ctx.now);
      return { ok: true as const, notes: [] };

    case "restore": {
      const result = await restoreVersion(db, page, String(form.get("versionId") ?? ""), ctx.now, userId);
      return result.ok ? { ok: true as const, notes: [] } : { error: result.message };
    }

    case "ai-draft": {
      // Not in the demo. Anyone on the internet can sign in there, and this is
      // the one control on the screen that spends money on an outside service.
      requireNotDemo(ctx, "Drafting with AI");

      const facts = await gatherFacts(db, club);
      const others = await listPages(db, site.id);
      const result = await proposePage(
        ctx.env,
        db,
        {
          facts,
          brief: String(form.get("brief") ?? "").slice(0, 500),
          pageTitle: page.title,
          existingSlugs: others.map((p) => p.slug),
          current: blocks,
          pageId: page.id,
          userId,
          today: ctx.today,
        },
        ctx.now,
      );

      if (!result.ok) return { error: result.message };

      // Straight into a version row. Nothing on the live page has changed and
      // nothing will until somebody presses Use this draft.
      const proposal = await saveProposal(
        db,
        page,
        result.blocks,
        { label: `Draft — ${ctx.today}` },
        ctx.now,
        userId,
      );

      return {
        ok: true as const,
        notes: result.notes.map((n) => n.message),
        proposalId: proposal.versionId,
        blanked: result.blanked,
      };
    }

    default:
      return { error: "We didn't recognise that." };
  }
}

// ── Field rendering ───────────────────────────────────────────────────────────

function MediaSelect({
  name,
  value,
  media,
}: {
  name: string;
  value: string;
  media: { id: string; filename: string }[];
}) {
  return (
    <Select name={name} defaultValue={value}>
      <option value="">No picture</option>
      {media.map((m) => (
        <option key={m.id} value={m.id}>
          {m.filename}
        </option>
      ))}
    </Select>
  );
}

function FieldInput({
  name,
  spec,
  value,
  media,
}: {
  name: string;
  spec: FieldSpec;
  value: unknown;
  media: { id: string; filename: string }[];
}) {
  const text = typeof value === "string" ? value : "";

  switch (spec.kind) {
    case "text":
      return spec.multiline ? (
        <Textarea name={name} defaultValue={text} rows={spec.max > 1000 ? 8 : 3} maxLength={spec.max} />
      ) : (
        <Input name={name} defaultValue={text} maxLength={spec.max} />
      );
    case "url":
      return <Input name={name} defaultValue={text} placeholder="/visit or https://…" />;
    case "enum":
      return (
        <Select name={name} defaultValue={text || spec.fallback}>
          {spec.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      );
    case "int":
      return (
        <Input
          type="number"
          name={name}
          min={spec.min}
          max={spec.max}
          defaultValue={typeof value === "number" ? value : spec.fallback}
        />
      );
    case "bool":
      return (
        <>
          {/* Paired hidden field: an unticked box submits nothing, and without
              this the save would read "absent" as "leave it alone" and the
              club could never turn the option off. */}
          <input type="hidden" name={name} value="0" />
          <label className="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
            <input type="checkbox" name={name} defaultChecked={value !== false} />
            Yes
          </label>
        </>
      );
    case "media":
      return <MediaSelect name={name} value={text} media={media} />;
    case "icon":
      return (
        <Select name={name} defaultValue={text}>
          <option value="">None</option>
          {["calendar", "users", "heart", "globe", "handshake", "award", "book", "leaf",
            "droplet", "graduation", "stethoscope", "home", "utensils", "megaphone",
            "map-pin", "clock", "mail", "phone", "sparkles", "wheel",
            "ticket", "file-text"].map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </Select>
      );
    case "list":
      return null; // handled by BlockEditor
  }
}

function BlockEditor({
  block,
  index,
  total,
  media,
}: {
  block: Block;
  index: number;
  total: number;
  media: { id: string; filename: string }[];
}) {
  const def: BlockDef = BLOCKS[block.type];
  const fields = Object.entries(def.fields as Record<string, FieldSpec>);
  const scalars = fields.filter(([, s]) => s.kind !== "list");
  const lists = fields.filter(([, s]) => s.kind === "list");

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-ink-900 dark:text-ink-100">{def.label}</h3>
          <p className="text-sm text-ink-500">{def.blurb}</p>
        </div>
        <div className="flex items-center gap-1">
          {def.live && <Chip tone="brand">Fills itself in</Chip>}
          <Form method="post">
            <input type="hidden" name="intent" value="block-up" />
            <input type="hidden" name="blockId" value={block.id} />
            <button
              className="flex size-9 items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 disabled:opacity-30"
              disabled={index === 0}
              aria-label="Move up"
            >
              ↑
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="block-down" />
            <input type="hidden" name="blockId" value={block.id} />
            <button
              className="flex size-9 items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 disabled:opacity-30"
              disabled={index === total - 1}
              aria-label="Move down"
            >
              ↓
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="block-remove" />
            <input type="hidden" name="blockId" value={block.id} />
            <button
              className="flex size-9 items-center justify-center rounded-lg text-ink-400 hover:text-risk-500"
              aria-label={`Remove the ${def.label.toLowerCase()} section`}
            >
              ✕
            </button>
          </Form>
        </div>
      </div>

      {def.live && (
        <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-ink-700 dark:bg-brand-950/30 dark:text-ink-300">
          This section reads your own records when somebody loads the page, so it's never out of
          date. You're only writing the heading around it.
        </p>
      )}

      <Form method="post" className="mt-4 space-y-4">
        <input type="hidden" name="intent" value="block-save" />
        <input type="hidden" name="blockId" value={block.id} />
        <input type="hidden" name="blockType" value={block.type} />

        <div className="grid gap-4 sm:grid-cols-2">
          {scalars.map(([name, spec]) => (
            <div key={name} className={spec.kind === "text" && spec.multiline ? "sm:col-span-2" : ""}>
              <Field
                label={spec.label}
                name={fieldName(name)}
                hint={"hint" in spec ? spec.hint : undefined}
              >
                <FieldInput name={fieldName(name)} spec={spec} value={block[name]} media={media} />
              </Field>
            </div>
          ))}
        </div>

        {lists.map(([name, spec]) => {
          if (spec.kind !== "list") return null;
          const items = Array.isArray(block[name]) ? (block[name] as Record<string, unknown>[]) : [];
          // A couple of blank rows past whatever exists, capped by the block's
          // own limit. Enough to add something without a round trip; not so
          // many that the form becomes a wall.
          const rows = Math.min(spec.max, Math.max(items.length + 2, Math.min(LIST_ROWS, spec.max)));

          return (
            <fieldset key={name} className="rounded-lg border border-ink-200 p-4 dark:border-ink-800">
              <legend className="px-1 text-sm font-medium text-ink-700 dark:text-ink-300">
                {spec.label}{" "}
                <span className="font-normal text-ink-500">— up to {spec.max}</span>
              </legend>
              <div className="space-y-3">
                {Array.from({ length: rows }, (_, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-3">
                    {Object.entries(spec.of).map(([sub, subSpec]) => (
                      <label key={sub} className="block text-sm">
                        <span className="mb-1 block text-xs text-ink-500">{subSpec.label}</span>
                        <FieldInput
                          name={itemFieldName(name, i, sub)}
                          spec={subSpec}
                          value={items[i]?.[sub]}
                          media={media}
                        />
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-500">Leave a row empty to drop it.</p>
            </fieldset>
          );
        })}

        <Button variant="secondary">Save this section</Button>
      </Form>
    </Card>
  );
}

// ── The screen ────────────────────────────────────────────────────────────────

export default function SitePageEditor({ loaderData, actionData }: Route.ComponentProps) {
  const { page, blocks, media, versions, canPublish, aiReady, previewBase, otherPages } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const notes = (actionData && "notes" in actionData ? actionData.notes : undefined) ?? [];
  const blanked = (actionData && "blanked" in actionData ? actionData.blanked : undefined) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title={page.title}
        subtitle={
          <>
            <Link to="/app/site" className="underline underline-offset-4 hover:text-brand-700">
              Website
            </Link>{" "}
            · /{page.slug}
            {page.isHome && " · your home page"}
          </>
        }
        action={
          canPublish ? (
            <Form method="post">
              <input type="hidden" name="intent" value={page.status === "published" ? "unpublish" : "publish"} />
              <Button variant={page.status === "published" ? "secondary" : "primary"} disabled={busy}>
                {page.status === "published" ? "Unpublish" : "Publish this page"}
              </Button>
            </Form>
          ) : null
        }
      />

      {actionData && "error" in actionData && actionData.error && (
        <p className="mb-6 rounded-lg border border-risk-500/30 bg-risk-500/5 px-4 py-3 text-sm text-ink-800 dark:text-ink-200">
          {actionData.error}
        </p>
      )}

      {notes.length > 0 && (
        <div className="mb-6 rounded-lg border border-watch-500/30 bg-watch-500/5 px-4 py-3 text-sm text-ink-800 dark:text-ink-200">
          <p className="font-medium">We tidied a couple of things:</p>
          <ul className="mt-1 list-disc pl-5">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {blanked.length > 0 && (
        <div className="mb-6 rounded-lg border border-watch-500/30 bg-watch-500/5 px-4 py-3 text-sm text-ink-800 dark:text-ink-200">
          <p className="font-medium">
            The draft included {blanked.length} figure{blanked.length === 1 ? "" : "s"} we couldn't
            verify, so {blanked.length === 1 ? "it was" : "they were"} replaced with [ ].
          </p>
          <p className="mt-1">
            {blanked.join(", ")} — fill in the real numbers, or take the sentences out. We'd rather
            show you a blank than let a made-up figure onto your front page.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {blocks.length === 0 && (
            <Card>
              <p className="text-ink-600 dark:text-ink-400">
                Nothing on this page yet. Add a section below, or ask for a draft.
              </p>
            </Card>
          )}

          {blocks.map((block, i) => (
            <BlockEditor key={block.id} block={block} index={i} total={blocks.length} media={media} />
          ))}

          <Card>
            <h3 className="font-medium text-ink-900 dark:text-ink-100">Add a section</h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {BLOCK_TYPES.map((type) => {
                const def: BlockDef = BLOCKS[type];
                return (
                  <Form method="post" key={type}>
                    <input type="hidden" name="intent" value="block-add" />
                    <input type="hidden" name="blockType" value={type} />
                    <button className="w-full rounded-lg border border-ink-200 p-3 text-left transition hover:border-brand-400 dark:border-ink-800">
                      <span className="block font-medium text-ink-800 dark:text-ink-200">
                        {def.label}
                      </span>
                      <span className="block text-sm text-ink-500">{def.blurb}</span>
                    </button>
                  </Form>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {/* ── Drafting ─────────────────────────────────────────────────── */}
          <Card>
            <h3 className="font-medium text-ink-900 dark:text-ink-100">Ask for a draft</h3>
            {aiReady ? (
              <>
                <p className="mt-1 mb-3 text-sm text-ink-600 dark:text-ink-400">
                  It reads your club's own record — projects, meeting time, charter year — and
                  writes a whole page. It lands as a draft you read before anything changes.
                </p>
                <Form method="post" className="space-y-3">
                  <input type="hidden" name="intent" value="ai-draft" />
                  <Textarea
                    name="brief"
                    rows={3}
                    maxLength={500}
                    placeholder="What's this page for? e.g. persuade someone who's never heard of Rotary to come to lunch."
                  />
                  <Button variant="secondary" className="w-full" disabled={busy}>
                    {busy ? "Writing…" : "Write me a draft"}
                  </Button>
                </Form>
                <p className="mt-3 text-xs text-ink-500">
                  It can't invent a number. Anything it wanted but we couldn't verify comes back as
                  [ ] for you to fill in.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                Drafting isn't switched on for this club. Everything else on this screen works —
                this button would just write a first draft for you to edit.
              </p>
            )}
          </Card>

          {/* ── Page settings ────────────────────────────────────────────── */}
          <Card>
            <h3 className="mb-4 font-medium text-ink-900 dark:text-ink-100">This page</h3>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="page-settings" />
              <Field label="Title" name="title">
                <Input id="title" name="title" defaultValue={page.title} required />
              </Field>
              {!page.isHome && (
                <Field label="Address" name="slug" hint="The bit after the slash.">
                  <Input id="slug" name="slug" defaultValue={page.slug} />
                </Field>
              )}
              <Field label="Menu label" name="navLabel" hint="If the title is too long for the menu.">
                <Input id="navLabel" name="navLabel" defaultValue={page.navLabel ?? ""} />
              </Field>
              <Field
                label="Search description"
                name="description"
                hint="What Google shows under the link. Leave blank and we'll use the page's own first paragraph."
              >
                <Textarea id="description" name="description" rows={2} defaultValue={page.description ?? ""} />
              </Field>

              <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
                <input type="checkbox" name="showInNav" defaultChecked={page.showInNav} />
                Show in the menu
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-300">
                <input type="checkbox" name="noindex" defaultChecked={page.noindex} />
                Keep out of search engines
              </label>

              {canPublish && (
                <Field
                  label="Publish later"
                  name="scheduledFor"
                  hint="Leave blank to publish by hand. Times are UTC."
                >
                  <Input
                    id="scheduledFor"
                    type="datetime-local"
                    name="scheduledFor"
                    defaultValue={page.scheduledFor ? page.scheduledFor.slice(0, 16) : ""}
                  />
                </Field>
              )}

              <Button variant="secondary" className="w-full">
                Save
              </Button>
            </Form>
          </Card>

          {/* ── Preview + history ────────────────────────────────────────── */}
          <Card>
            <h3 className="font-medium text-ink-900 dark:text-ink-100">Look at it</h3>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
              {page.status === "published"
                ? "This page is published, so this is the real thing."
                : "This page is a draft. Use a preview link from the website screen to see it."}
            </p>
            {page.status === "published" && (
              <a
                href={page.slug ? `${previewBase}/${page.slug}` : previewBase}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm underline underline-offset-4 hover:text-brand-700"
              >
                Open the live page ↗
              </a>
            )}
          </Card>

          {versions.length > 0 && (
            <Card>
              <h3 className="font-medium text-ink-900 dark:text-ink-100">History</h3>
              <p className="mt-1 mb-3 text-sm text-ink-600 dark:text-ink-400">
                Every save and every draft. Putting one back is one click, and doing so saves what's
                there now first.
              </p>
              <ul className="space-y-2">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-ink-700 dark:text-ink-300">
                        {v.label ?? (v.kind === "ai_proposal" ? "AI draft" : "Edit")}
                      </span>
                      <span className="text-xs text-ink-500">
                        {formatDate(v.createdAt)} · {v.sections} sections
                      </span>
                    </span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore" />
                      <input type="hidden" name="versionId" value={v.id} />
                      <Button variant="quiet" className="px-2">
                        {v.kind === "ai_proposal" ? "Use this draft" : "Put back"}
                      </Button>
                    </Form>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {otherPages.length > 0 && (
            <Card>
              <h3 className="font-medium text-ink-900 dark:text-ink-100">Linking</h3>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
                In any link box, these addresses point at your own pages:
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {otherPages.map((p) => (
                  <li key={p.slug} className="text-ink-600 dark:text-ink-400">
                    <code className="rounded bg-ink-100 px-1.5 py-0.5 text-xs dark:bg-ink-800">
                      /{p.slug}
                    </code>{" "}
                    {p.title}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
