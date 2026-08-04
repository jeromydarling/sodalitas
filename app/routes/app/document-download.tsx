/**
 * document-download.tsx — hand over the bytes, to the right people only.
 *
 * This is the route where the visibility rule has to actually hold. Everything
 * else in the library is a listing, and a listing that leaks is embarrassing;
 * this one hands over the file, and it is the only place that matters.
 *
 * Three things it does deliberately:
 *
 *   **Asks for the document by audience.** `documentFor` puts the visibility
 *   check in the WHERE clause, so a board document requested by a member comes
 *   back as null and 404s. Not 403 — telling somebody "that exists but isn't
 *   yours" about the board minutes is itself a small leak.
 *
 *   **Always sends `attachment`.** Whatever the declared type, nothing here
 *   renders inside the club's own origin.
 *
 *   **Never streams past the tenant.** The key is read from the row that was
 *   already tenant-scoped, never from the URL.
 */

import type { Route } from "./+types/document-download";
import { envContext } from "@worker/loadContext";
import { getContext } from "@worker/context";
import { documentFor, noteDownload } from "@db/services/documents";
import { audienceFor } from "@domain/documents";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("documents.read");
  const db = ctx.db();

  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) throw new Response("Not found", { status: 404 });

  const audience = audienceFor({
    signedIn: true,
    boardAccess: ctx.can("documents.read_board", club.id),
  });

  const doc = await documentFor(db, params.documentId, audience);
  if (!doc) throw new Response("Not found", { status: 404 });

  const object = await ctx.env.R2.get(doc.r2_key);
  if (!object) {
    // The row outlived its bytes. Say so plainly rather than serving an empty
    // file that looks like a corrupt download.
    throw new Response("This document's file is missing. Ask whoever uploaded it to add it again.", {
      status: 404,
    });
  }

  // Counted, not awaited — a failing counter must never be why a club can't
  // open its own bylaws.
  void noteDownload(db, doc.id);

  return new Response(object.body, {
    headers: {
      "Content-Type": doc.content_type,
      "Content-Length": String(doc.bytes),
      "Content-Disposition": `attachment; filename="${doc.filename.replace(/"/g, "")}"`,
      // Private: this is a per-person authorisation decision, and a shared
      // cache holding the board minutes would hand them to the next request.
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
