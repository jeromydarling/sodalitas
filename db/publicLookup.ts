/**
 * publicLookup.ts — the one sanctioned cross-tenant read.
 *
 * A public club page is fetched by slug with no session. The tenant is the
 * *answer* to the lookup, not an input to it, so this one query cannot go
 * through TenantDb — and `clubs` is deliberately not in GLOBAL_TABLES, because
 * widening that list would let any code read any club.
 *
 * So the exception lives here, alone, with a name nobody types by accident and
 * a shape that can only ever return the handful of columns a public page needs.
 * Everything downstream of it scopes to the tenant it returns.
 *
 * If a second cross-tenant read is ever needed, it belongs in this file too,
 * so the complete list of them stays one screen long and reviewable.
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
