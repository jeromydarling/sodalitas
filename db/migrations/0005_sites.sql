-- 0005_sites.sql — the club website: brand kits, pages, media, custom domains.
--
-- Until now a club got one public page at /club/<slug>. That was an honest
-- MVP and we said so on the marketing site: "it's one page, not a website
-- builder." This migration is what makes that sentence false, so it changes in
-- the same commit.
--
-- Three design decisions worth stating before the tables:
--
--   **A page is data, not markup.** `blocks_json` holds an ordered array of
--   typed sections validated by domain/blocks.ts. Nothing anywhere stores HTML
--   a club or a model typed. That is what lets us restyle every club's site
--   when the theme changes, render the same page as AMP-ish plain HTML for a
--   crawler, and — the part that actually matters — accept AI-generated content
--   without ever handing a language model a script tag.
--
--   **The AI proposes into a version, never onto the live page.** Every
--   generation writes a `site_page_versions` row and stops. A human opens it,
--   reads it, and presses apply. This is the same posture as every other AI
--   feature here, and it is the reason a club can leave generation switched on.
--
--   **A custom hostname belongs to exactly one site, globally.** The UNIQUE on
--   `site_domains.hostname` deliberately spans tenants: two clubs cannot both
--   claim rotaryclubofsomewhere.org, because whoever proved ownership first
--   holds it until they release it. That is the one place in this schema where
--   a constraint crosses the tenant boundary on purpose.

-- ── Brand kits ────────────────────────────────────────────────────────────────
--
-- A palette, a typeface pairing and a voice, stored per club. Rotary clubs are
-- licensed users of a strong existing brand, so most kits start from a Rotary
-- preset rather than from nothing — but a club that wants Azure and Cranberry
-- instead of Royal Blue and Gold is inside the guidelines and we let them.
CREATE TABLE brand_kits (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id     TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Where it came from: 'preset' | 'ai' | 'manual' | 'logo'. Recorded because
  -- "which of these did a person actually choose" is the number worth watching.
  source      TEXT NOT NULL DEFAULT 'preset',
  -- The preset it started from, if any. Kept so we can offer "reset to the
  -- Rotary defaults" without guessing which defaults.
  preset_key  TEXT,
  -- JSON: { palette: {…}, fonts: {…}, radius, density, voice: {…} }.
  -- Validated by domain/palette.ts on every read as well as every write —
  -- a token that has drifted becomes a CSS custom property on a public page,
  -- so it is never trusted just because it is already in the database.
  tokens_json TEXT NOT NULL,
  -- The club's logo, if they uploaded one. Files live in R2 via site_media.
  logo_media_id TEXT,
  -- Null until a human applies it. An AI proposal sits here, visible and
  -- unapplied, for as long as the club likes.
  applied_at  TEXT,
  applied_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_brand_kits_club ON brand_kits(tenant_id, club_id, applied_at);

-- ── The site ──────────────────────────────────────────────────────────────────
CREATE TABLE club_sites (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id       TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- 'draft' until somebody publishes. A draft site is reachable only by a
  -- signed-in officer or through a preview link.
  status        TEXT NOT NULL DEFAULT 'draft',
  -- Layout family: 'classic' | 'civic' | 'editorial' | 'compact'. Distinct from
  -- the brand kit, which is colour and type — the theme is structure.
  theme_key     TEXT NOT NULL DEFAULT 'classic',
  brand_kit_id  TEXT REFERENCES brand_kits(id) ON DELETE SET NULL,
  home_page_id  TEXT,
  -- JSON array of { pageId | href, label }. Ordered. The nav is explicit rather
  -- than derived from pages, because "every page is in the nav" stops being
  -- true the moment a club writes their fourteenth committee page.
  nav_json      TEXT,
  footer_json   TEXT,
  -- JSON: { ga4, gtm, metaPixel, plausible }. IDs only, each one re-validated
  -- against a strict per-provider format before it is rendered into a page.
  -- We build the snippet; a club never gets to paste script tags at us.
  analytics_json TEXT,
  -- Site-wide SEO defaults: JSON { titleSuffix, description, ogMediaId }.
  seo_json      TEXT,
  -- SHA-256 of a preview token. Lets a club send a draft to the board before
  -- it is public. Hashed like every other token here, so a database dump is
  -- not a set of working links.
  preview_token_hash TEXT,
  published_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (tenant_id, club_id)
);
CREATE INDEX idx_club_sites_club ON club_sites(tenant_id, club_id);
CREATE INDEX idx_club_sites_preview ON club_sites(preview_token_hash);

-- ── Pages ─────────────────────────────────────────────────────────────────────
CREATE TABLE site_pages (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id       TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  site_id       TEXT NOT NULL REFERENCES club_sites(id) ON DELETE CASCADE,
  -- '' is the home page. Every other slug is a single path segment.
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  nav_label     TEXT,
  description   TEXT,
  -- The ordered blocks. See domain/blocks.ts — nothing writes here without
  -- passing through validateBlocks().
  blocks_json   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  show_in_nav   INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  -- Set to publish itself later. The 15-minute cron picks these up. Stored as
  -- an ISO instant so "8pm Thursday" means the same thing in every timezone
  -- the board happens to be sitting in.
  scheduled_for TEXT,
  noindex       INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (tenant_id, site_id, slug)
);
CREATE INDEX idx_site_pages_site ON site_pages(tenant_id, site_id, sort_order);
CREATE INDEX idx_site_pages_scheduled ON site_pages(scheduled_for)
  WHERE scheduled_for IS NOT NULL AND status = 'draft';

-- ── Versions ──────────────────────────────────────────────────────────────────
--
-- Every publish and every AI proposal writes one. Two jobs: a club can undo,
-- and a club can read what the model suggested before deciding. `kind` is
-- 'edit' | 'publish' | 'ai_proposal'; an AI proposal is the only kind that can
-- exist without ever having been the live content.
CREATE TABLE site_page_versions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_id     TEXT NOT NULL REFERENCES site_pages(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'edit',
  title       TEXT NOT NULL,
  blocks_json TEXT NOT NULL,
  -- Short human label: "Before the AI rewrite", "Published 12 Aug".
  label       TEXT,
  -- The ai_invocations row, when a model produced this. Lets the audit trail
  -- join a piece of published copy back to the prompt version that wrote it.
  invocation_id TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_site_versions_page ON site_page_versions(tenant_id, page_id, created_at);

-- ── Media ─────────────────────────────────────────────────────────────────────
--
-- The club's own uploads. Separate from `files` because these are public by
-- definition: anything here can be linked from a page anyone on the internet
-- can read, and mixing that with a member's scanned application form in one
-- table is how the wrong thing ends up on the wrong page.
CREATE TABLE site_media (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id      TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  r2_key       TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL DEFAULT 0,
  width        INTEGER,
  height       INTEGER,
  -- Required on insert by the service layer, not by the schema, so an import
  -- can land first and the club can be nagged to describe them afterwards.
  -- An image with no alt text renders with an empty alt rather than a filename:
  -- a screen reader reading "IMG_4471.jpg" is worse than silence.
  alt_text     TEXT,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_site_media_club ON site_media(tenant_id, club_id, created_at);

-- ── Custom domains ────────────────────────────────────────────────────────────
--
-- Cloudflare for SaaS. The club points a CNAME at our zone; we create a custom
-- hostname; Cloudflare issues the certificate. Everything below the hostname
-- itself is Cloudflare's answer, cached so the settings screen can render
-- without an API call on every load.
CREATE TABLE site_domains (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id       TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  site_id       TEXT NOT NULL REFERENCES club_sites(id) ON DELETE CASCADE,
  -- Lowercased, punycode, no trailing dot. UNIQUE across every tenant on
  -- purpose — see the header note.
  hostname      TEXT NOT NULL UNIQUE,
  -- Cloudflare's custom hostname id. Null while we are running dark (no API
  -- token configured): the club can still record the hostname and see the
  -- instructions, and the row activates when the token lands.
  cf_hostname_id TEXT,
  -- 'pending' | 'active' | 'error' | 'deleted'. Our own summary of Cloudflare's
  -- hostname status and certificate status together, because a club does not
  -- need to learn the difference to point a domain at their club page.
  status        TEXT NOT NULL DEFAULT 'pending',
  cf_status     TEXT,
  ssl_status    TEXT,
  -- The records the club has to add, exactly as Cloudflare returned them.
  -- Stored rather than re-fetched so the instructions on screen never change
  -- underneath somebody halfway through typing them into GoDaddy.
  ownership_name  TEXT,
  ownership_value TEXT,
  dcv_txt_name    TEXT,
  dcv_txt_value   TEXT,
  -- JSON array of Cloudflare's verification_errors, shown verbatim. A club
  -- with a CAA record blocking Let's Encrypt needs the real message.
  errors_json   TEXT,
  last_checked_at TEXT,
  activated_at  TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_site_domains_club ON site_domains(tenant_id, club_id);
CREATE INDEX idx_site_domains_pending ON site_domains(status) WHERE status = 'pending';
