import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/site";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { issueToken } from "@worker/auth/crypto";
import {
  getOrCreateSite, listPages, createPage, deletePage, publishPage, unpublishPage,
  setSiteLive, updateSiteSettings, listDomains, activeTokens, reorderPages,
} from "@db/services/sites";
import { SITE_THEMES } from "@content/rotary";
import { ANALYTICS_PROVIDERS, parseAnalytics, validateId } from "@domain/analytics";
import { parseBlocks } from "@domain/blocks";
import { Icon } from "~/brand";
import { PageHeader, Card, Chip, Button, ButtonLink, Field, Input, Select, formatDate } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Website");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.edit");
  const db = ctx.db();

  const club = await db.first<{
    id: string; name: string; slug: string; city: string | null;
    state_code: string | null; charter_date: string | null;
  }>("clubs", { columns: "id, name, slug, city, state_code, charter_date" });
  if (!club) throw new Response("This account has no club yet.", { status: 404 });

  // Creates the site and its starter pages the first time anybody looks. A
  // club that opens this screen finds four drafted pages rather than a button
  // marked "create your first page".
  const site = await getOrCreateSite(db, club, ctx.now, ctx.user?.id ?? null);

  const [pages, domains, tokens] = await Promise.all([
    listPages(db, site.id),
    listDomains(db, club.id),
    activeTokens(db, site),
  ]);

  return {
    club: { name: club.name, slug: club.slug },
    site: {
      id: site.id,
      status: site.status,
      theme: site.theme_key,
      publishedAt: site.published_at,
      hasPreview: Boolean(site.preview_token_hash),
    },
    tokens,
    analytics: parseAnalytics(site.analytics_json),
    pages: pages.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      status: p.status,
      isHome: p.id === site.home_page_id,
      sections: parseBlocks(p.blocks_json).length,
      showInNav: p.show_in_nav === 1,
      scheduledFor: p.scheduled_for,
      updatedAt: p.updated_at,
    })),
    domains: domains.map((d) => ({ hostname: d.hostname, status: d.status })),
    canPublish: ctx.can("site.publish"),
    canDomain: ctx.can("site.domain"),
    publicUrl: `${ctx.env.APP_URL}/club/${club.slug}`,
    appUrl: ctx.env.APP_URL,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.edit");
  const db = ctx.db();

  const club = await db.first<{
    id: string; name: string; city: string | null;
    state_code: string | null; charter_date: string | null;
  }>("clubs", { columns: "id, name, city, state_code, charter_date" });
  if (!club) return { error: "This account has no club yet." };

  const site = await getOrCreateSite(db, club, ctx.now, ctx.user?.id ?? null);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "new-page") {
    const title = String(form.get("title") ?? "").trim();
    if (!title) return { error: "What should the page be called?" };
    const page = await createPage(
      db,
      { siteId: site.id, clubId: club.id, title },
      ctx.now,
      ctx.user?.id ?? null,
    );
    return redirect(`/app/site/${page.id}`);
  }

  if (intent === "delete-page") {
    const result = await deletePage(db, site, String(form.get("pageId") ?? ""), ctx.now);
    return result.ok ? { ok: true } : { error: result.message };
  }

  if (intent === "move-page") {
    const pages = await listPages(db, site.id);
    const id = String(form.get("pageId") ?? "");
    const index = pages.findIndex((p) => p.id === id);
    const target = index + (String(form.get("direction")) === "up" ? -1 : 1);
    if (index !== -1 && target >= 0 && target < pages.length) {
      const order = pages.map((p) => p.id);
      order.splice(target, 0, ...order.splice(index, 1));
      await reorderPages(db, site.id, order, ctx.now);
    }
    return { ok: true };
  }

  if (intent === "publish-page" || intent === "unpublish-page") {
    ctx.require("site.publish");
    const page = await db.byId<{ id: string; blocks_json: string; title: string; site_id: string; slug: string; status: "draft" | "published" }>(
      "site_pages",
      String(form.get("pageId") ?? ""),
    );
    if (!page) return { error: "We couldn't find that page." };
    if (intent === "publish-page") {
      await publishPage(db, page as never, ctx.now, ctx.user?.id ?? null);
    } else {
      await unpublishPage(db, page.id, ctx.now);
    }
    return { ok: true };
  }

  if (intent === "site-live" || intent === "site-draft") {
    ctx.require("site.publish");
    await setSiteLive(db, site.id, intent === "site-live", ctx.now);
    return { ok: true };
  }

  if (intent === "theme") {
    await updateSiteSettings(db, site.id, { themeKey: String(form.get("themeKey") ?? "") }, ctx.now);
    return { ok: true };
  }

  if (intent === "analytics") {
    const next: Record<string, string> = {};
    for (const provider of ANALYTICS_PROVIDERS) {
      const raw = String(form.get(provider.key) ?? "");
      const verdict = validateId(provider.key, raw);
      // One bad id stops the save and says which. Silently dropping it would
      // leave a club staring at an empty box wondering whether it took.
      if (!verdict.ok) return { error: verdict.message };
      if (verdict.value) next[provider.key] = verdict.value;
    }
    await updateSiteSettings(db, site.id, { analytics: next }, ctx.now);
    return { ok: true, saved: "analytics" };
  }

  if (intent === "preview-link") {
    // Regenerating is how a club revokes a link they shouldn't have sent, so
    // the old one stops working the moment a new one is made. Stored hashed;
    // shown once, here, and never again.
    const token = await issueToken();
    await db.update("club_sites", site.id, { preview_token_hash: token.hash, updated_at: ctx.now });
    return { ok: true, previewToken: token.token };
  }

  return { error: "We didn't recognise that." };
}

export default function SiteOverview({ loaderData, actionData }: Route.ComponentProps) {
  const { club, site, pages, domains, canPublish, canDomain, publicUrl, appUrl, analytics } = loaderData;
  const live = site.status === "live";
  const publishedPages = pages.filter((p) => p.status === "published").length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Website"
        subtitle={
          live
            ? "Your site is live. Changes to a page go public when you publish that page."
            : "Your site is a draft. Nobody outside the club can see it until you turn it on."
        }
        action={
          canPublish ? (
            <Form method="post">
              <input type="hidden" name="intent" value={live ? "site-draft" : "site-live"} />
              <Button variant={live ? "secondary" : "primary"} disabled={publishedPages === 0 && !live}>
                {live ? "Take the site offline" : "Put the site live"}
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

      {publishedPages === 0 && !live && (
        <Card className="mb-6 border-brand-200 bg-brand-50/60 dark:border-brand-900 dark:bg-brand-950/30">
          <p className="font-medium text-ink-900 dark:text-ink-100">
            Four pages are already drafted from what we know about {club.name}.
          </p>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            Read them, change what's wrong, publish the ones you want. The meetings and projects
            sections fill themselves in from your own records, so those are already right.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {/* ── Pages ───────────────────────────────────────────────────── */}
          <Card>
            <div className="flex items-center justify-between gap-4 pb-4">
              <h2 className="font-medium text-ink-900 dark:text-ink-100">Pages</h2>
              <span className="text-sm text-ink-500">
                {publishedPages} of {pages.length} published
              </span>
            </div>

            <ul className="divide-y divide-ink-100 dark:divide-ink-800/60">
              {pages.map((page, i) => (
                <li key={page.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/app/site/${page.id}`}
                      prefetch="intent"
                      className="font-medium text-ink-900 hover:text-brand-700 dark:text-ink-100"
                    >
                      {page.title}
                    </Link>
                    <p className="truncate text-sm text-ink-500">
                      /{page.slug}
                      {page.isHome && " · home page"}
                      {" · "}
                      {page.sections} section{page.sections === 1 ? "" : "s"}
                      {page.scheduledFor && ` · goes live ${formatDate(page.scheduledFor)}`}
                    </p>
                  </div>

                  <Chip tone={page.status === "published" ? "steady" : "neutral"}>
                    {page.status === "published" ? "Published" : "Draft"}
                  </Chip>

                  <div className="flex items-center gap-1">
                    <Form method="post">
                      <input type="hidden" name="intent" value="move-page" />
                      <input type="hidden" name="pageId" value={page.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        className="flex size-9 items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 disabled:opacity-30"
                        disabled={i === 0}
                        aria-label={`Move ${page.title} up`}
                      >
                        ↑
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="move-page" />
                      <input type="hidden" name="pageId" value={page.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        className="flex size-9 items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 disabled:opacity-30"
                        disabled={i === pages.length - 1}
                        aria-label={`Move ${page.title} down`}
                      >
                        ↓
                      </button>
                    </Form>

                    {canPublish && (
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value={page.status === "published" ? "unpublish-page" : "publish-page"}
                        />
                        <input type="hidden" name="pageId" value={page.id} />
                        <Button variant="quiet" className="px-2">
                          {page.status === "published" ? "Unpublish" : "Publish"}
                        </Button>
                      </Form>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <Form method="post" className="mt-5 flex flex-wrap items-end gap-3 border-t border-ink-100 pt-5 dark:border-ink-800/60">
              <input type="hidden" name="intent" value="new-page" />
              <div className="min-w-48 flex-1">
                <Field label="Add a page" name="title" hint="A committee, a fundraiser, your history.">
                  <Input id="title" name="title" placeholder="Our annual auction" required />
                </Field>
              </div>
              <Button variant="secondary">Add</Button>
            </Form>
          </Card>

          {/* ── Analytics ───────────────────────────────────────────────── */}
          <Card>
            <h2 className="font-medium text-ink-900 dark:text-ink-100">Your own analytics</h2>
            <p className="mt-1 mb-4 text-sm text-ink-600 dark:text-ink-400">
              Paste an ID and we'll add the right code. We never accept a script — that's a security
              hole with a friendly label, and the ID is all any of these actually need.
            </p>

            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="analytics" />
              {ANALYTICS_PROVIDERS.map((provider) => (
                <Field
                  key={provider.key}
                  label={provider.name}
                  name={provider.key}
                  hint={`${provider.hint} ${provider.where}`}
                >
                  <Input
                    id={provider.key}
                    name={provider.key}
                    defaultValue={analytics[provider.key] ?? ""}
                    placeholder={provider.placeholder}
                    spellCheck={false}
                  />
                </Field>
              ))}
              <div className="flex items-center gap-3">
                <Button variant="secondary">Save</Button>
                {actionData && "saved" in actionData && actionData.saved === "analytics" && (
                  <span className="text-sm text-steady-500">Saved.</span>
                )}
              </div>
            </Form>
            <p className="mt-4 text-xs text-ink-500">
              These are your accounts and your visitors' data goes to you, not to us. We say so in
              your site's footer automatically — several privacy laws require it and most club sites
              quietly don't.
            </p>
          </Card>
        </div>

        {/* ── Side column ───────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <h2 className="font-medium text-ink-900 dark:text-ink-100">Where it lives</h2>
            <p className="mt-2 text-sm break-all text-ink-600 dark:text-ink-400">
              <a href={publicUrl} className="underline underline-offset-4 hover:text-brand-700">
                {publicUrl.replace(/^https:\/\//, "")}
              </a>
            </p>

            {domains.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm">
                {domains.map((d) => (
                  <li key={d.hostname} className="flex items-center justify-between gap-2">
                    <span className="truncate text-ink-700 dark:text-ink-300">{d.hostname}</span>
                    <Chip tone={d.status === "active" ? "steady" : d.status === "error" ? "risk" : "watch"}>
                      {d.status === "active" ? "Live" : d.status === "error" ? "Needs attention" : "Waiting"}
                    </Chip>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-500">
                You can use your club's own address instead — rotaryclubofsomewhere.org rather than
                ours.
              </p>
            )}

            {canDomain && (
              <ButtonLink to="/app/site/domains" variant="secondary" className="mt-4 w-full">
                <Icon.District /> Your own address
              </ButtonLink>
            )}
          </Card>

          <Card>
            <h2 className="font-medium text-ink-900 dark:text-ink-100">Show it to the board</h2>
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
              A link that shows the whole site, drafts included, to anyone you send it to. Making a
              new one stops the old one working.
            </p>

            {actionData && "previewToken" in actionData && actionData.previewToken ? (
              <div className="mt-3">
                <p className="text-xs text-ink-500">
                  Copy this now — we store it hashed, so it can't be shown again.
                </p>
                <code className="mt-1.5 block rounded-lg bg-ink-100 px-3 py-2 text-xs break-all dark:bg-ink-800">
                  {appUrl}/preview/{actionData.previewToken}
                </code>
              </div>
            ) : (
              site.hasPreview && (
                <p className="mt-3 text-sm text-ink-500">
                  A link already exists. If you've lost it, make a new one.
                </p>
              )
            )}

            <Form method="post" className="mt-4">
              <input type="hidden" name="intent" value="preview-link" />
              <Button variant="secondary" className="w-full">
                {site.hasPreview ? "Make a new link" : "Make a preview link"}
              </Button>
            </Form>
          </Card>

          <Card>
            <h2 className="font-medium text-ink-900 dark:text-ink-100">Layout</h2>
            <p className="mt-1 mb-3 text-sm text-ink-600 dark:text-ink-400">
              Structure only. Colour and type live in{" "}
              <Link to="/app/site/brand" className="underline underline-offset-4">
                the brand studio
              </Link>
              .
            </p>
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="theme" />
              <Select name="themeKey" defaultValue={site.theme}>
                {SITE_THEMES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name} — {t.blurb}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" className="w-full">
                Change layout
              </Button>
            </Form>
          </Card>
        </div>
      </div>
    </div>
  );
}
