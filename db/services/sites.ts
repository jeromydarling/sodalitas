/**
 * sites.ts — reading and writing a club's website.
 *
 * Everything here is tenant-scoped. The one place a site is reached without a
 * tenant — a visitor arriving on the club's own domain — goes through
 * db/publicLookup.ts, which resolves the hostname to a tenant first and then
 * comes back here scoped.
 *
 * Two rules this file exists to enforce:
 *
 *   Nothing reaches `blocks_json` without `validateBlocks`. Not the editor, not
 *   a model, not a restore from an old version. `savePage` is the only writer.
 *
 *   Publishing is explicit and versioned. Every save that changes the live
 *   content leaves a `site_page_versions` row behind, so a club that publishes
 *   something regrettable at 11pm can put it back in one click.
 */

import type { TenantDb } from "../scope";
import { newId } from "@domain/ids";
import { validateBlocks, serialiseBlocks, parseBlocks, type Block, type ValidationNote } from "@domain/blocks";
import { validateTokens, parseTokens, type BrandTokens } from "@domain/palette";
import { validateAnalytics, parseAnalytics, type AnalyticsConfig } from "@domain/analytics";
import { brandPreset, isThemeKey, type ThemeKey } from "@content/rotary";

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface SiteRow {
  id: string;
  club_id: string;
  status: "draft" | "live";
  theme_key: string;
  brand_kit_id: string | null;
  home_page_id: string | null;
  nav_json: string | null;
  footer_json: string | null;
  analytics_json: string | null;
  seo_json: string | null;
  preview_token_hash: string | null;
  published_at: string | null;
}

export interface PageRow {
  id: string;
  site_id: string;
  club_id: string;
  slug: string;
  title: string;
  nav_label: string | null;
  description: string | null;
  blocks_json: string;
  status: "draft" | "published";
  show_in_nav: number;
  sort_order: number;
  scheduled_for: string | null;
  noindex: number;
  published_at: string | null;
  updated_at: string;
}

export interface MediaRow {
  id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  created_at: string;
}

export interface DomainRow {
  id: string;
  site_id: string;
  hostname: string;
  cf_hostname_id: string | null;
  status: "pending" | "active" | "error" | "deleted";
  cf_status: string | null;
  ssl_status: string | null;
  ownership_name: string | null;
  ownership_value: string | null;
  dcv_txt_name: string | null;
  dcv_txt_value: string | null;
  errors_json: string | null;
  last_checked_at: string | null;
  activated_at: string | null;
}

export interface BrandKitRow {
  id: string;
  club_id: string;
  name: string;
  source: string;
  preset_key: string | null;
  tokens_json: string;
  logo_media_id: string | null;
  applied_at: string | null;
  created_at: string;
}

// ── Slugs ─────────────────────────────────────────────────────────────────────

/** One path segment, lowercase, no surprises. `""` is the home page. */
export function pageSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/**
 * Slugs a club may not take.
 *
 * `preview` and `api` would collide with routes we serve on the club's own
 * hostname. The rest are reserved because a club page at /login on the club's
 * own domain, styled by the club, is a phishing page we built for them.
 */
const RESERVED_SLUGS = new Set([
  "api", "preview", "login", "logout", "signup", "app", "admin", "auth",
  "invite", "unsubscribe", "pay", "assets", "robots.txt", "sitemap.xml",
  "_", "well-known",
]);

async function uniquePageSlug(db: TenantDb, siteId: string, desired: string): Promise<string> {
  const base = pageSlug(desired) || "page";
  for (let i = 0; i < 30; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (RESERVED_SLUGS.has(candidate)) continue;
    const taken = await db.first<{ id: string }>("site_pages", {
      columns: "id",
      where: "site_id = ? AND slug = ?",
      params: [siteId, candidate],
    });
    if (!taken) return candidate;
  }
  return `${base}-${newId("sitePage").slice(-6).toLowerCase()}`;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

// ── The site ──────────────────────────────────────────────────────────────────

export async function siteFor(db: TenantDb, clubId: string): Promise<SiteRow | null> {
  return db.first<SiteRow>("club_sites", { where: "club_id = ?", params: [clubId] });
}

/**
 * Get the club's site, creating it with starter pages if it has none.
 *
 * Called the first time an officer opens the website screen, and by the signup
 * flow. Starter pages are drafted from the club's own record — its name, city,
 * charter date and meeting time — rather than from a template with
 * "[CLUB NAME]" in it. A club that never touches this still has a truthful
 * site; a club that opens it finds something to edit rather than a blank page,
 * which is the difference between finishing and abandoning.
 */
export async function getOrCreateSite(
  db: TenantDb,
  club: { id: string; name: string; city: string | null; state_code: string | null; charter_date: string | null },
  now: string,
  userId: string | null,
): Promise<SiteRow> {
  const existing = await siteFor(db, club.id);
  if (existing) return existing;

  const siteId = newId("site");
  const kitId = newId("brandKit");
  const preset = brandPreset("royal")!;

  await db.insert("brand_kits", {
    id: kitId,
    club_id: club.id,
    name: preset.name,
    source: "preset",
    preset_key: preset.key,
    tokens_json: JSON.stringify(
      validateTokens({
        brandHex: preset.brandHex,
        accentHex: preset.accentHex,
        fontPair: preset.fontPair,
        radius: preset.radius,
        density: preset.density,
      }),
    ),
    applied_at: now,
    applied_by: userId,
    created_at: now,
    updated_at: now,
  });

  await db.insert("club_sites", {
    id: siteId,
    club_id: club.id,
    status: "draft",
    theme_key: "classic",
    brand_kit_id: kitId,
    created_at: now,
    updated_at: now,
  });

  const pages = starterPages(club);
  let homeId: string | null = null;
  for (const [index, page] of pages.entries()) {
    const id = newId("sitePage");
    if (index === 0) homeId = id;
    await db.insert("site_pages", {
      id,
      club_id: club.id,
      site_id: siteId,
      slug: page.slug,
      title: page.title,
      nav_label: page.navLabel,
      description: null,
      blocks_json: serialiseBlocks(validateBlocks(page.blocks).blocks),
      status: "draft",
      show_in_nav: page.slug === "" ? 0 : 1,
      sort_order: index,
      noindex: 0,
      created_by: userId,
      updated_by: userId,
      created_at: now,
      updated_at: now,
    });
  }

  await db.update("club_sites", siteId, { home_page_id: homeId, updated_at: now });
  return (await siteFor(db, club.id))!;
}

export interface SiteSettingsInput {
  themeKey?: string;
  brandKitId?: string | null;
  analytics?: unknown;
  seo?: { titleSuffix?: string; description?: string; ogMediaId?: string };
  nav?: { pageId?: string; href?: string; label: string }[];
}

export async function updateSiteSettings(
  db: TenantDb,
  siteId: string,
  input: SiteSettingsInput,
  now: string,
): Promise<void> {
  const values: Record<string, unknown> = { updated_at: now };
  if (input.themeKey !== undefined) {
    values.theme_key = isThemeKey(input.themeKey) ? input.themeKey : "classic";
  }
  if (input.brandKitId !== undefined) values.brand_kit_id = input.brandKitId;
  if (input.analytics !== undefined) {
    values.analytics_json = JSON.stringify(validateAnalytics(input.analytics));
  }
  if (input.seo !== undefined) {
    values.seo_json = JSON.stringify({
      titleSuffix: String(input.seo.titleSuffix ?? "").slice(0, 60),
      description: String(input.seo.description ?? "").slice(0, 300),
      ogMediaId: /^sm_[0-9A-Z]{22}$/.test(String(input.seo.ogMediaId ?? "")) ? input.seo.ogMediaId : "",
    });
  }
  if (input.nav !== undefined) {
    values.nav_json = JSON.stringify(
      input.nav.slice(0, 12).map((item) => ({
        pageId: typeof item.pageId === "string" ? item.pageId.slice(0, 40) : undefined,
        href: typeof item.href === "string" ? item.href.slice(0, 300) : undefined,
        label: String(item.label ?? "").slice(0, 40),
      })),
    );
  }
  await db.update("club_sites", siteId, values);
}

/**
 * Publish or unpublish the whole site.
 *
 * Separate from publishing a page. A club builds the site over three weeks with
 * every page published and the site still dark, then turns it on once.
 */
export async function setSiteLive(
  db: TenantDb,
  siteId: string,
  live: boolean,
  now: string,
): Promise<void> {
  await db.update("club_sites", siteId, {
    status: live ? "live" : "draft",
    published_at: live ? now : null,
    updated_at: now,
  });
}

// ── Pages ─────────────────────────────────────────────────────────────────────

export async function listPages(db: TenantDb, siteId: string): Promise<PageRow[]> {
  return db.all<PageRow>("site_pages", {
    where: "site_id = ?",
    params: [siteId],
    orderBy: "sort_order ASC, created_at ASC",
  });
}

export async function pageBySlug(db: TenantDb, siteId: string, slug: string): Promise<PageRow | null> {
  return db.first<PageRow>("site_pages", {
    where: "site_id = ? AND slug = ?",
    params: [siteId, slug],
  });
}

export async function pageById(db: TenantDb, pageId: string): Promise<PageRow | null> {
  return db.byId<PageRow>("site_pages", pageId);
}

export async function createPage(
  db: TenantDb,
  input: { siteId: string; clubId: string; title: string; slug?: string; blocks?: unknown },
  now: string,
  userId: string | null,
): Promise<PageRow> {
  const slug = await uniquePageSlug(db, input.siteId, input.slug || input.title);
  const last = await db.first<{ sort_order: number }>("site_pages", {
    columns: "sort_order",
    where: "site_id = ?",
    params: [input.siteId],
    orderBy: "sort_order DESC",
  });

  const id = newId("sitePage");
  await db.insert("site_pages", {
    id,
    club_id: input.clubId,
    site_id: input.siteId,
    slug,
    title: input.title.trim().slice(0, 120) || "New page",
    nav_label: null,
    description: null,
    blocks_json: serialiseBlocks(validateBlocks(input.blocks ?? []).blocks),
    status: "draft",
    show_in_nav: 1,
    sort_order: (last?.sort_order ?? 0) + 1,
    noindex: 0,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
  });
  return (await pageById(db, id))!;
}

export interface SavePageInput {
  title?: string;
  navLabel?: string | null;
  description?: string | null;
  slug?: string;
  blocks?: unknown;
  showInNav?: boolean;
  noindex?: boolean;
  scheduledFor?: string | null;
}

/**
 * The only writer of page content.
 *
 * Snapshots the previous content into a version *before* overwriting, so undo
 * exists without the editor having to think about it. The snapshot is skipped
 * when the content is unchanged — otherwise renaming a page fills the history
 * with identical rows and buries the version somebody actually wants.
 */
export async function savePage(
  db: TenantDb,
  page: PageRow,
  input: SavePageInput,
  now: string,
  userId: string | null,
): Promise<{ page: PageRow; notes: ValidationNote[] }> {
  const values: Record<string, unknown> = { updated_at: now, updated_by: userId };
  let notes: ValidationNote[] = [];

  if (input.blocks !== undefined) {
    const validated = validateBlocks(input.blocks);
    notes = validated.notes;
    const next = serialiseBlocks(validated.blocks);
    if (next !== page.blocks_json) {
      await snapshot(db, page, "edit", null, now, userId);
      values.blocks_json = next;
    }
  }
  if (input.title !== undefined) values.title = input.title.trim().slice(0, 120) || page.title;
  if (input.navLabel !== undefined) {
    values.nav_label = input.navLabel ? input.navLabel.trim().slice(0, 40) : null;
  }
  if (input.description !== undefined) {
    values.description = input.description ? input.description.trim().slice(0, 300) : null;
  }
  if (input.slug !== undefined && page.slug !== "") {
    // The home page keeps its empty slug forever — moving it would break every
    // link anybody has ever shared.
    const desired = pageSlug(input.slug);
    if (desired && desired !== page.slug) {
      values.slug = await uniquePageSlug(db, page.site_id, desired);
    }
  }
  if (input.showInNav !== undefined) values.show_in_nav = input.showInNav ? 1 : 0;
  if (input.noindex !== undefined) values.noindex = input.noindex ? 1 : 0;
  if (input.scheduledFor !== undefined) values.scheduled_for = input.scheduledFor;

  await db.update("site_pages", page.id, values);
  return { page: (await pageById(db, page.id))!, notes };
}

export async function publishPage(
  db: TenantDb,
  page: PageRow,
  now: string,
  userId: string | null,
): Promise<void> {
  await snapshot(db, page, "publish", `Published ${now.slice(0, 10)}`, now, userId);
  await db.update("site_pages", page.id, {
    status: "published",
    published_at: now,
    scheduled_for: null,
    updated_at: now,
    updated_by: userId,
  });
}

export async function unpublishPage(db: TenantDb, pageId: string, now: string): Promise<void> {
  await db.update("site_pages", pageId, { status: "draft", updated_at: now });
}

/**
 * Delete a page.
 *
 * Refuses to delete the home page: a site with no home page 404s at its own
 * address, and the club would have to notice that themselves.
 */
export async function deletePage(
  db: TenantDb,
  site: SiteRow,
  pageId: string,
  now: string,
): Promise<{ ok: boolean; message?: string }> {
  if (site.home_page_id === pageId) {
    return { ok: false, message: "This is your home page, so it can't be deleted. Rewrite it instead." };
  }
  await db.remove("site_pages", pageId, now);
  return { ok: true };
}

export async function reorderPages(
  db: TenantDb,
  siteId: string,
  orderedIds: string[],
  now: string,
): Promise<void> {
  const pages = await listPages(db, siteId);
  const known = new Set(pages.map((p) => p.id));
  let order = 0;
  for (const id of orderedIds) {
    if (!known.has(id)) continue;
    await db.update("site_pages", id, { sort_order: order++, updated_at: now });
  }
}

// ── Versions ──────────────────────────────────────────────────────────────────

export interface VersionRow {
  id: string;
  page_id: string;
  kind: "edit" | "publish" | "ai_proposal";
  title: string;
  blocks_json: string;
  label: string | null;
  invocation_id: string | null;
  created_at: string;
}

/**
 * Record the page's current content as a version.
 *
 * Skips when the newest version already holds exactly this content. Without
 * that check, publishing an unchanged page a second time — which officers do,
 * because pressing the button again is what you do when you aren't sure it
 * worked — writes another identical row, and after a fortnight the history
 * panel is six copies of the same thing and useless for the one job it has.
 */
async function snapshot(
  db: TenantDb,
  page: PageRow,
  kind: VersionRow["kind"],
  label: string | null,
  now: string,
  userId: string | null,
): Promise<string | null> {
  const latest = await db.first<{ id: string; blocks_json: string; title: string }>(
    "site_page_versions",
    {
      columns: "id, blocks_json, title",
      where: "page_id = ?",
      params: [page.id],
      orderBy: "created_at DESC",
    },
  );
  if (latest && latest.blocks_json === page.blocks_json && latest.title === page.title) {
    return null;
  }

  const id = newId("siteVersion");
  await db.insert("site_page_versions", {
    id,
    page_id: page.id,
    kind,
    title: page.title,
    blocks_json: page.blocks_json,
    label,
    created_by: userId,
    created_at: now,
  });
  return id;
}

export async function listVersions(db: TenantDb, pageId: string, limit = 20): Promise<VersionRow[]> {
  return db.all<VersionRow>("site_page_versions", {
    where: "page_id = ?",
    params: [pageId],
    orderBy: "created_at DESC",
    limit,
  });
}

/**
 * Record what a model proposed, without applying any of it.
 *
 * The proposal is a version like any other, so applying it is the same code
 * path as undoing to any other point in history — and a club can look at what
 * the model wrote next week, having done nothing about it today.
 */
export async function saveProposal(
  db: TenantDb,
  page: PageRow,
  blocks: unknown,
  meta: { label: string; invocationId?: string | null },
  now: string,
  userId: string | null,
): Promise<{ versionId: string; blocks: Block[]; notes: ValidationNote[] }> {
  const validated = validateBlocks(blocks);
  const id = newId("siteVersion");
  await db.insert("site_page_versions", {
    id,
    page_id: page.id,
    kind: "ai_proposal",
    title: page.title,
    blocks_json: serialiseBlocks(validated.blocks),
    label: meta.label.slice(0, 80),
    invocation_id: meta.invocationId ?? null,
    created_by: userId,
    created_at: now,
  });
  return { versionId: id, blocks: validated.blocks, notes: validated.notes };
}

/** Put a version's content back onto the page. Snapshots first, as ever. */
export async function restoreVersion(
  db: TenantDb,
  page: PageRow,
  versionId: string,
  now: string,
  userId: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const version = await db.byId<VersionRow>("site_page_versions", versionId);
  if (!version || version.page_id !== page.id) {
    return { ok: false, message: "That version doesn't belong to this page." };
  }
  await snapshot(db, page, "edit", "Before restoring an earlier version", now, userId);
  // Re-validated on the way back in: the block registry may have changed since
  // this version was written, and a field that no longer exists must not
  // reappear on a live page.
  await db.update("site_pages", page.id, {
    blocks_json: serialiseBlocks(parseBlocks(version.blocks_json)),
    updated_at: now,
    updated_by: userId,
  });
  return { ok: true };
}

// ── Brand kits ────────────────────────────────────────────────────────────────

export async function listBrandKits(db: TenantDb, clubId: string): Promise<BrandKitRow[]> {
  return db.all<BrandKitRow>("brand_kits", {
    where: "club_id = ?",
    params: [clubId],
    orderBy: "created_at DESC",
    limit: 25,
  });
}

/** The tokens a page renders with. Falls back to the defaults, never to null. */
export async function activeTokens(db: TenantDb, site: SiteRow): Promise<BrandTokens> {
  if (!site.brand_kit_id) return validateTokens(null);
  const kit = await db.byId<BrandKitRow>("brand_kits", site.brand_kit_id);
  return parseTokens(kit?.tokens_json);
}

export async function createBrandKit(
  db: TenantDb,
  input: { clubId: string; name: string; source: string; presetKey?: string | null; tokens: unknown; logoMediaId?: string | null },
  now: string,
): Promise<BrandKitRow> {
  const id = newId("brandKit");
  await db.insert("brand_kits", {
    id,
    club_id: input.clubId,
    name: input.name.trim().slice(0, 60) || "Untitled",
    source: ["preset", "ai", "manual", "logo"].includes(input.source) ? input.source : "manual",
    preset_key: input.presetKey ?? null,
    tokens_json: JSON.stringify(validateTokens(input.tokens)),
    logo_media_id: input.logoMediaId ?? null,
    applied_at: null,
    created_at: now,
    updated_at: now,
  });
  return (await db.byId<BrandKitRow>("brand_kits", id))!;
}

export async function updateBrandKit(
  db: TenantDb,
  kitId: string,
  input: { name?: string; tokens?: unknown; logoMediaId?: string | null },
  now: string,
): Promise<void> {
  const values: Record<string, unknown> = { updated_at: now };
  if (input.name !== undefined) values.name = input.name.trim().slice(0, 60) || "Untitled";
  if (input.tokens !== undefined) values.tokens_json = JSON.stringify(validateTokens(input.tokens));
  if (input.logoMediaId !== undefined) values.logo_media_id = input.logoMediaId;
  await db.update("brand_kits", kitId, values);
}

/**
 * Apply a kit to the site.
 *
 * The one moment an AI proposal stops being a proposal, and it takes a person
 * pressing a button. `applied_at` is stamped so the Brand Studio can show which
 * kits were ever actually used rather than a list of six identical-looking
 * experiments.
 */
export async function applyBrandKit(
  db: TenantDb,
  site: SiteRow,
  kitId: string,
  now: string,
  userId: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const kit = await db.byId<BrandKitRow>("brand_kits", kitId);
  if (!kit || kit.club_id !== site.club_id) {
    return { ok: false, message: "That brand kit belongs to a different club." };
  }
  await db.update("brand_kits", kitId, { applied_at: now, applied_by: userId, updated_at: now });
  await db.update("club_sites", site.id, { brand_kit_id: kitId, updated_at: now });
  return { ok: true };
}

// ── Media ─────────────────────────────────────────────────────────────────────

export async function listMedia(db: TenantDb, clubId: string, limit = 100): Promise<MediaRow[]> {
  return db.all<MediaRow>("site_media", {
    where: "club_id = ?",
    params: [clubId],
    orderBy: "created_at DESC",
    limit,
  });
}

export async function mediaByIds(db: TenantDb, ids: string[]): Promise<Map<string, MediaRow>> {
  const wanted = [...new Set(ids.filter(Boolean))].slice(0, 60);
  if (wanted.length === 0) return new Map();
  const rows = await db.all<MediaRow>("site_media", {
    where: `id IN (${wanted.map(() => "?").join(",")})`,
    params: wanted,
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/** What R2 key a club's upload gets. Tenant-prefixed so a listing can't cross. */
export function mediaKey(tenantId: string, clubId: string, mediaId: string, filename: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(filename)?.[1]?.toLowerCase() ?? "bin";
  return `sites/${tenantId}/${clubId}/${mediaId}.${ext}`;
}

/** Image types a club page may carry. Anything else is refused at upload. */
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

/** 8MB. A phone photograph is 3–5; anything bigger is a scan or a mistake. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function recordMedia(
  db: TenantDb,
  input: {
    id: string;
    clubId: string;
    r2Key: string;
    filename: string;
    contentType: string;
    bytes: number;
    width?: number | null;
    height?: number | null;
    altText?: string | null;
  },
  now: string,
  userId: string | null,
): Promise<void> {
  await db.insert("site_media", {
    id: input.id,
    club_id: input.clubId,
    r2_key: input.r2Key,
    filename: input.filename.slice(0, 200),
    content_type: input.contentType,
    bytes: input.bytes,
    width: input.width ?? null,
    height: input.height ?? null,
    alt_text: input.altText ? input.altText.trim().slice(0, 300) : null,
    uploaded_by: userId,
    created_at: now,
  });
}

export async function setAltText(db: TenantDb, mediaId: string, alt: string): Promise<void> {
  await db.update("site_media", mediaId, { alt_text: alt.trim().slice(0, 300) || null });
}

// ── Domains ───────────────────────────────────────────────────────────────────

export async function listDomains(db: TenantDb, clubId: string): Promise<DomainRow[]> {
  return db.all<DomainRow>("site_domains", {
    where: "club_id = ? AND status != 'deleted'",
    params: [clubId],
    orderBy: "created_at ASC",
  });
}

export async function domainById(db: TenantDb, id: string): Promise<DomainRow | null> {
  return db.byId<DomainRow>("site_domains", id);
}

export async function recordDomain(
  db: TenantDb,
  input: { clubId: string; siteId: string; hostname: string },
  now: string,
  userId: string | null,
): Promise<{ ok: boolean; id?: string; message?: string }> {
  const id = newId("siteDomain");
  try {
    await db.insert("site_domains", {
      id,
      club_id: input.clubId,
      site_id: input.siteId,
      hostname: input.hostname,
      status: "pending",
      created_by: userId,
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    // The UNIQUE on hostname spans every tenant on purpose. Whoever proved
    // ownership first holds it; the message says so without telling this club
    // anything about the other one.
    if (String(err).includes("UNIQUE")) {
      return {
        ok: false,
        message: "That address is already claimed here. If it's yours and you didn't add it, get in touch and we'll sort it out.",
      };
    }
    throw err;
  }
  return { ok: true, id };
}

export async function updateDomainStatus(
  db: TenantDb,
  domainId: string,
  input: {
    cfHostnameId?: string | null;
    status?: DomainRow["status"];
    cfStatus?: string | null;
    sslStatus?: string | null;
    ownership?: { name: string; value: string } | null;
    dcv?: { name: string; value: string } | null;
    errors?: string[];
  },
  now: string,
): Promise<void> {
  const values: Record<string, unknown> = { last_checked_at: now, updated_at: now };
  if (input.cfHostnameId !== undefined) values.cf_hostname_id = input.cfHostnameId;
  if (input.status !== undefined) {
    values.status = input.status;
    if (input.status === "active") values.activated_at = now;
  }
  if (input.cfStatus !== undefined) values.cf_status = input.cfStatus;
  if (input.sslStatus !== undefined) values.ssl_status = input.sslStatus;
  if (input.ownership !== undefined) {
    values.ownership_name = input.ownership?.name ?? null;
    values.ownership_value = input.ownership?.value ?? null;
  }
  if (input.dcv !== undefined) {
    values.dcv_txt_name = input.dcv?.name ?? null;
    values.dcv_txt_value = input.dcv?.value ?? null;
  }
  if (input.errors !== undefined) {
    values.errors_json = input.errors.length ? JSON.stringify(input.errors.slice(0, 8)) : null;
  }
  await db.update("site_domains", domainId, values);
}

export async function removeDomain(db: TenantDb, domainId: string, now: string): Promise<void> {
  // Marked deleted rather than removed, so the hostname stays claimed for a
  // moment and a club that removes one by accident can be helped. Housekeeping
  // reaps rows older than a week.
  await db.update("site_domains", domainId, { status: "deleted", updated_at: now });
}

export function domainErrors(row: Pick<DomainRow, "errors_json">): string[] {
  if (!row.errors_json) return [];
  try {
    const parsed = JSON.parse(row.errors_json);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

// ── Reading a site for rendering ──────────────────────────────────────────────

export interface SiteConfig {
  site: SiteRow;
  tokens: BrandTokens;
  theme: ThemeKey;
  analytics: AnalyticsConfig;
  seo: { titleSuffix: string; description: string; ogMediaId: string };
  nav: { href: string; label: string }[];
}

/** Everything a rendered page needs about the site, in one read of two rows. */
export async function siteConfig(db: TenantDb, site: SiteRow): Promise<SiteConfig> {
  const [tokens, pages] = await Promise.all([activeTokens(db, site), listPages(db, site.id)]);

  const published = new Map(
    pages.filter((p) => p.status === "published").map((p) => [p.id, p]),
  );

  let nav: { href: string; label: string }[] = [];
  if (site.nav_json) {
    try {
      const parsed = JSON.parse(site.nav_json) as { pageId?: string; href?: string; label?: string }[];
      nav = parsed
        .map((item) => {
          if (item.pageId) {
            const page = published.get(item.pageId);
            if (!page) return null;
            return { href: page.slug ? `/${page.slug}` : "/", label: item.label || page.nav_label || page.title };
          }
          if (item.href && /^(https:\/\/|\/)/.test(item.href)) {
            return { href: item.href, label: item.label ?? item.href };
          }
          return null;
        })
        .filter((x): x is { href: string; label: string } => x !== null);
    } catch {
      nav = [];
    }
  }
  if (nav.length === 0) {
    // No explicit nav: everything published and flagged for the nav, in order.
    nav = pages
      .filter((p) => p.status === "published" && p.show_in_nav === 1 && p.slug !== "")
      .map((p) => ({ href: `/${p.slug}`, label: p.nav_label || p.title }));
  }

  let seo = { titleSuffix: "", description: "", ogMediaId: "" };
  if (site.seo_json) {
    try {
      const parsed = JSON.parse(site.seo_json) as Record<string, unknown>;
      seo = {
        titleSuffix: String(parsed.titleSuffix ?? "").slice(0, 60),
        description: String(parsed.description ?? "").slice(0, 300),
        ogMediaId: /^sm_[0-9A-Z]{22}$/.test(String(parsed.ogMediaId ?? "")) ? String(parsed.ogMediaId) : "",
      };
    } catch {
      /* defaults */
    }
  }

  return {
    site,
    tokens,
    theme: isThemeKey(site.theme_key) ? site.theme_key : "classic",
    analytics: parseAnalytics(site.analytics_json),
    seo,
    nav,
  };
}

// ── Starter content ───────────────────────────────────────────────────────────

interface StarterPage {
  slug: string;
  title: string;
  navLabel: string;
  blocks: unknown[];
}

/**
 * The site a club gets before anybody has written a word.
 *
 * Deliberately not AI-generated. This runs at signup, when there may be no AI
 * key configured, and it has to work anyway. More importantly it must be *true*
 * — every sentence here is either about the club's own record or about Rotary
 * in general, and the two live blocks mean the meetings and projects sections
 * are correct on day one without anybody typing them.
 *
 * The AI's job is to make this better, not to make it exist.
 */
export function starterPages(club: {
  name: string;
  city: string | null;
  state_code: string | null;
  charter_date: string | null;
}): StarterPage[] {
  const place = club.city ? `${club.city}${club.state_code ? `, ${club.state_code}` : ""}` : null;
  const since = club.charter_date ? club.charter_date.slice(0, 4) : null;

  return [
    {
      slug: "",
      title: club.name,
      navLabel: "Home",
      blocks: [
        {
          type: "hero",
          eyebrow: since ? `Serving ${place ?? "our community"} since ${since}` : "Rotary",
          heading: club.name,
          body: place
            ? `We're a group of people in ${place} who meet regularly and get things done. Visitors are welcome at any meeting.`
            : "We're a group of people who meet regularly and get things done. Visitors are welcome at any meeting.",
          ctaLabel: "Come to a meeting",
          ctaHref: "/visit",
          secondaryLabel: "What we do",
          secondaryHref: "/what-we-do",
          layout: "split",
        },
        {
          type: "meetings",
          heading: "Coming up",
          intro: "Straight from our calendar — always current.",
          count: 4,
          showSpeaker: true,
          showLocation: true,
          emptyText: "Nothing on the calendar just now. Get in touch and we'll tell you when we next meet.",
        },
        {
          type: "projects",
          heading: "What we've been doing",
          count: 3,
          showArea: true,
        },
        {
          type: "cta",
          heading: "Come and see for yourself",
          body: "There's no obligation and no sales pitch. Turn up, have lunch, meet a few people.",
          ctaLabel: "Get in touch",
          ctaHref: "/visit",
          tone: "brand",
        },
      ],
    },
    {
      slug: "what-we-do",
      title: "What we do",
      navLabel: "What we do",
      blocks: [
        {
          type: "richText",
          heading: "What we do",
          body:
            "Rotary clubs run service projects in their own community and support work internationally. " +
            "The specifics differ from club to club — this is where we describe ours.\n\n" +
            "Replace this with what your club actually does. Two or three real examples beat a paragraph of general description.",
        },
        { type: "projects", heading: "Current projects", count: 6, showArea: true },
        {
          type: "cards",
          heading: "Where we put our effort",
          intro: "Rotary organises its work into seven areas of focus. These are the ones we're most involved in.",
          columns: 3,
          items: [
            { icon: "droplet", title: "Water and sanitation", body: "Clean water, and the hygiene education that makes it stick." },
            { icon: "graduation", title: "Education and literacy", body: "Books, tutoring, and scholarships." },
            { icon: "leaf", title: "Environment", body: "Local conservation work." },
          ],
        },
      ],
    },
    {
      slug: "visit",
      title: "Visit us",
      navLabel: "Visit",
      blocks: [
        {
          type: "richText",
          heading: "Come to a meeting",
          body:
            "Anyone can visit a Rotary meeting. You don't need an invitation and you're not committing to anything by coming.\n\n" +
            "Let us know you're coming and we'll look out for you.",
        },
        { type: "meetings", heading: "Next few meetings", count: 6, showSpeaker: true, showLocation: true },
        {
          type: "contact",
          heading: "Where and when",
          meetsText: "",
          addressText: place ?? "",
          email: "",
          phone: "",
        },
        {
          type: "join",
          heading: "Tell us you're coming",
          body: "We'll say hello when you arrive and make sure you're not sitting on your own.",
          buttonLabel: "Send",
          thanksText: "Thanks — someone will be in touch before the meeting.",
        },
      ],
    },
    {
      slug: "about",
      title: "About the club",
      navLabel: "About",
      blocks: [
        {
          type: "richText",
          heading: "About us",
          body: since
            ? `${club.name} was chartered in ${since}. Write the rest of the story here — clubs consistently underestimate how interesting their own history is to somebody deciding whether to visit.`
            : `Write the club's story here. How it started, what it's known for locally, and who tends to join.`,
        },
        { type: "officers", heading: "This year's officers", intro: "" },
        {
          type: "faq",
          heading: "Questions people ask",
          items: [
            { q: "Do I have to be invited to join?", a: "No. Ask any member, or use the form on the visit page." },
            { q: "What does it cost?", a: "Replace this with your club's dues, and say what they cover." },
            { q: "How much time does it take?", a: "Replace this with an honest answer. Clubs that overstate it lose people in the first year." },
          ],
        },
      ],
    },
  ];
}
