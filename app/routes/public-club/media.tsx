/**
 * media.tsx — serving a club's own pictures.
 *
 * A resource route: no component, just bytes out of R2. It hangs off the club
 * slug rather than living at a global `/media/:id` so the tenant comes from the
 * URL — the media row is then read through a TenantDb like everything else, and
 * there is no sixth cross-tenant lookup to justify.
 *
 * Anything here is public by definition. `site_media` is a separate table from
 * `files` for exactly this reason: a member's scanned application form lives in
 * `files` and can never be reached through this route, because this route can
 * only read the other table.
 */

import type { Route } from "./+types/media";
import { envContext } from "@worker/loadContext";
import { tenantDb } from "@db/scope";
import { resolvePublicClubBySlug } from "@db/publicLookup";
import type { MediaRow } from "@db/services/sites";

/** A year, immutable. The id is content-addressed enough — it never changes. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.get(envContext);

  const club = await resolvePublicClubBySlug(env.DB, params.clubSlug);
  if (!club) return new Response("Not found", { status: 404 });

  const db = tenantDb(env.DB, club.tenant_id);
  const media = await db.first<MediaRow>("site_media", {
    where: "id = ? AND club_id = ?",
    params: [params.mediaId, club.id],
  });
  if (!media) return new Response("Not found", { status: 404 });

  // Conditional GET before the R2 read: a browser that already has the image
  // gets 304 without us paying for a class-B operation.
  const etag = `"${media.id}"`;
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE_CONTROL } });
  }

  const object = await env.R2.get(media.r2_key);
  if (!object) return new Response("Not found", { status: 404 });

  return new Response(object.body, {
    headers: {
      // The stored type, which was checked against an allow-list at upload.
      // Never the browser's guess: `X-Content-Type-Options` below makes that
      // stick, so an SVG smuggled in as a PNG cannot execute as a document.
      "Content-Type": media.content_type,
      "Content-Length": String(media.bytes || object.size),
      "Cache-Control": CACHE_CONTROL,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
