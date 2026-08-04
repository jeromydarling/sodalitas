/**
 * document.tsx — a public document, to anyone who asks.
 *
 * The counterpart to /app/documents/:id, and the reason `documentFor` takes an
 * audience rather than returning the row: this route hands the same function
 * `"public"` and gets back only what the club published. There is no second
 * implementation of the visibility rule here to drift out of step with the
 * first one.
 *
 * No session, no cookie, no capability. That is the whole point of a public
 * document — but it means the audience is hard-coded rather than derived, so
 * that no future change to how sessions resolve can accidentally widen it.
 */

import { data } from "react-router";
import type { Route } from "./+types/document";
import { envContext } from "@worker/loadContext";
import { tenantDb } from "@db/scope";
import { resolvePublicClubBySlug } from "@db/publicLookup";
import { documentFor, noteDownload } from "@db/services/documents";

export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.get(envContext);
  const club = await resolvePublicClubBySlug(env.DB, params.clubSlug);
  if (!club) throw data("No club at that address.", { status: 404 });

  const db = tenantDb(env.DB, club.tenant_id);
  const doc = await documentFor(db, params.documentId, "public");
  // A members' document and a document that never existed give the same
  // answer, on purpose.
  if (!doc || doc.club_id !== club.id) throw data("No document at that address.", { status: 404 });

  const object = await env.R2.get(doc.r2_key);
  if (!object) throw data("That file is missing. Please let the club know.", { status: 404 });

  void noteDownload(db, doc.id);

  return new Response(object.body, {
    headers: {
      "Content-Type": doc.content_type,
      "Content-Length": String(doc.bytes),
      // Always an attachment, never inline. Nothing in a club's library gets
      // to execute on the club's own domain.
      "Content-Disposition": `attachment; filename="${doc.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      // Public and cacheable — it is a published document — but only for an
      // hour, so replacing a superseded version takes effect the same day.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
