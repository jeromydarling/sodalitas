/**
 * publicLookup.ts — the sanctioned cross-tenant reads. All of them.
 *
 * Each one answers a request that arrives with no session: a public club page
 * fetched by slug, an unsubscribe link from an email, an invitation to join a
 * club. In every case the tenant is the *answer* to the lookup rather than an
 * input to it, so none of them can go through TenantDb — and `clubs`, `invites`
 * and `email_unsubscribe_tokens` are all deliberately absent from GLOBAL_TABLES,
 * because widening that list would let any code read any tenant's rows.
 *
 * So the exceptions live here together, with names nobody types by accident and
 * shapes that return only what the caller genuinely needs. Everything downstream
 * of them scopes to the tenant they return.
 *
 * The rule for adding another: it goes in this file, so the complete list stays
 * reviewable in one sitting. If that ever stops being possible, the design is
 * wrong and needs a conversation rather than another export.
 *
 * Two were added when clubs got real websites, and both are the same shape as
 * the club-by-slug read: a visitor arrives on `rotaryclubofsomewhere.org` or on
 * a preview link, and the tenant is what we are looking up rather than
 * something we already know.
 *
 * The token lookups below are safe to key on a bare token because every one of
 * those tokens is 256 bits of CSPRNG output stored only as a SHA-256 hash — the
 * secret is unguessable, and a stolen database yields no working links.
 */

/** Exactly the columns a public club page may show. Nothing else is selected. */
export interface PublicClubRef {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  city: string | null;
  state_code: string | null;
  charter_date: string | null;
  public_blurb: string | null;
  meeting_blurb: string | null;
  website_url: string | null;
}

/**
 * Resolve a club by its public slug.
 *
 * Returns null for a slug that doesn't exist, a club that has switched its
 * public page off, or a club that isn't active — all three are the same answer
 * to a visitor, and keeping them indistinguishable means a probe can't
 * enumerate which clubs use the product.
 */
export async function resolvePublicClubBySlug(
  db: D1Database,
  slug: string,
): Promise<PublicClubRef | null> {
  return db
    .prepare(
      `SELECT id, tenant_id, name, slug, city, state_code, charter_date,
              public_blurb, meeting_blurb, website_url
         FROM clubs
        WHERE slug = ? AND public_enabled = 1 AND status = 'active'
        LIMIT 1`,
    )
    .bind(slug)
    .first<PublicClubRef>();
}

/** What an unsubscribe page needs to know before it does anything. */
export interface UnsubscribeRef {
  tenant_id: string;
  email_norm: string;
  /** Already on the suppression list — the link was used before. */
  already: boolean;
}

/**
 * Resolve an unsubscribe token.
 *
 * Deliberately *not* single-use. An unsubscribe link is the one link in the
 * product that must keep working: somebody who clicks it twice, or forwards the
 * mail to a spouse, or comes back a month later to check it took, must not be
 * told their link is invalid. The cost of a reusable token here is that
 * whoever holds the email can unsubscribe that address — which is exactly the
 * person entitled to.
 *
 * Returns null only for a token that was never issued.
 */
export async function resolveUnsubscribeToken(
  db: D1Database,
  tokenHash: string,
): Promise<UnsubscribeRef | null> {
  const row = await db
    .prepare(
      `SELECT t.tenant_id, t.email_norm,
              EXISTS (
                SELECT 1 FROM email_suppressions s
                 WHERE s.tenant_id = t.tenant_id AND s.email_norm = t.email_norm
              ) AS already
         FROM email_unsubscribe_tokens t
        WHERE t.token_hash = ?
        LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ tenant_id: string; email_norm: string; already: number }>();

  if (!row) return null;
  return { tenant_id: row.tenant_id, email_norm: row.email_norm, already: row.already === 1 };
}

/** An invitation, with just enough context to show who it's from. */
export interface InviteRef {
  id: string;
  tenant_id: string;
  club_id: string | null;
  email_norm: string;
  person_id: string | null;
  role_key: string;
  expires_at: string;
  accepted_at: string | null;
  club_name: string | null;
}

/**
 * Resolve an invitation token.
 *
 * Returns the row even when expired or already accepted, so the page can say
 * which of those it is. "This invitation was already used" and "this invitation
 * ran out on 12 August" send somebody to different next steps, and collapsing
 * both into "invalid link" earns a support email every time.
 */
export async function resolveInviteToken(
  db: D1Database,
  tokenHash: string,
): Promise<InviteRef | null> {
  return db
    .prepare(
      `SELECT i.id, i.tenant_id, i.club_id, i.email_norm, i.person_id, i.role_key,
              i.expires_at, i.accepted_at, c.name AS club_name
         FROM invites i
         LEFT JOIN clubs c ON c.id = i.club_id AND c.tenant_id = i.tenant_id
        WHERE i.token_hash = ?
        LIMIT 1`,
    )
    .bind(tokenHash)
    .first<InviteRef>();
}

/** Enough to render a club's own-domain site, and nothing else. */
export interface PublicSiteRef {
  tenant_id: string;
  club_id: string;
  site_id: string;
  club_name: string;
  club_slug: string;
  /** 'live' or 'draft'. A draft site is served only through a preview link. */
  site_status: string;
  /** The hostname as we stored it, so a redirect can be exact. */
  hostname: string;
}

/**
 * Resolve a club site by the hostname a visitor typed.
 *
 * Runs on every request that does not arrive on our own hostname, so it is
 * deliberately one indexed lookup on a UNIQUE column and no joins beyond the
 * two it needs. A miss is the common case for a probe and must be cheap.
 *
 * Only `active` domains resolve. A pending one is a hostname whose certificate
 * has not issued, and serving a club's content at a half-configured address is
 * how a club discovers their site is live before they meant it to be.
 */
export async function resolveSiteByHostname(
  db: D1Database,
  hostname: string,
): Promise<PublicSiteRef | null> {
  return db
    .prepare(
      `SELECT d.tenant_id, d.club_id, d.site_id, d.hostname,
              c.name AS club_name, c.slug AS club_slug,
              s.status AS site_status
         FROM site_domains d
         JOIN club_sites s ON s.id = d.site_id AND s.tenant_id = d.tenant_id
         JOIN clubs c      ON c.id = d.club_id AND c.tenant_id = d.tenant_id
        WHERE d.hostname = ? AND d.status = 'active' AND c.status = 'active'
        LIMIT 1`,
    )
    .bind(hostname.toLowerCase())
    .first<PublicSiteRef>();
}

/**
 * Resolve a preview token.
 *
 * A club sends the board a link to the draft site before it goes public. The
 * token is per-site and regenerable — regenerating it is how a club revokes a
 * link they shouldn't have sent, which is the only revocation anybody would
 * think to ask for.
 *
 * Returns the site whatever its status, because previewing a draft is the
 * entire purpose.
 */
export async function resolveSitePreviewToken(
  db: D1Database,
  tokenHash: string,
): Promise<PublicSiteRef | null> {
  return db
    .prepare(
      `SELECT s.tenant_id, s.club_id, s.id AS site_id, s.status AS site_status,
              c.name AS club_name, c.slug AS club_slug, '' AS hostname
         FROM club_sites s
         JOIN clubs c ON c.id = s.club_id AND c.tenant_id = s.tenant_id
        WHERE s.preview_token_hash = ? AND c.status = 'active'
        LIMIT 1`,
    )
    .bind(tokenHash)
    .first<PublicSiteRef>();
}
