import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/site-media";
import { envContext } from "@worker/loadContext";
import { appMeta } from "~/seo";
import { getContext } from "@worker/context";
import { newId } from "@domain/ids";
import {
  listMedia, recordMedia, setAltText, mediaKey,
  ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES,
} from "@db/services/sites";
import { PageHeader, Card, Button, Field, Input, formatDate } from "~/ui";

export function meta(_: Route.MetaArgs) {
  return appMeta("Pictures");
}

const MB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

export async function loader({ request, context }: Route.LoaderArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.edit");
  const db = ctx.db();

  const club = await db.first<{ id: string; slug: string }>("clubs", { columns: "id, slug" });
  if (!club) throw new Response("This account has no club yet.", { status: 404 });

  const media = await listMedia(db, club.id, 200);
  return {
    clubSlug: club.slug,
    maxBytes: MAX_UPLOAD_BYTES,
    media: media.map((m) => ({
      id: m.id,
      filename: m.filename,
      bytes: m.bytes,
      alt: m.alt_text,
      createdAt: m.created_at,
      url: `/club/${club.slug}/media/${m.id}`,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await getContext(request, context.get(envContext));
  ctx.require("site.edit");
  const db = ctx.db();

  const club = await db.first<{ id: string }>("clubs", { columns: "id" });
  if (!club) return { error: "This account has no club yet." };

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "alt") {
    await setAltText(db, String(form.get("mediaId") ?? ""), String(form.get("alt") ?? ""));
    return { ok: true };
  }

  if (intent === "upload") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a picture to upload." };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        error: `That's ${MB(file.size)}, and the limit is ${MB(MAX_UPLOAD_BYTES)}. Most phones can export a smaller version, or any photo app will resize it.`,
      };
    }
    // The declared type, checked against an allow-list. SVG is deliberately
    // absent: an SVG is a document that can carry script, and one served from
    // a club's own domain would run there.
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      return {
        error: `We can take JPEG, PNG, WebP, AVIF and GIF. That one says it's ${file.type || "an unknown type"}.`,
      };
    }

    const id = newId("siteMedia");
    const key = mediaKey(ctx.tenantId!, club.id, id, file.name);

    await ctx.env.R2.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });

    await recordMedia(
      db,
      {
        id,
        clubId: club.id,
        r2Key: key,
        filename: file.name,
        contentType: file.type,
        bytes: file.size,
        altText: String(form.get("alt") ?? "") || null,
      },
      ctx.now,
      ctx.user?.id ?? null,
    );

    return { ok: true, uploaded: file.name };
  }

  return { error: "We didn't recognise that." };
}

export default function SiteMedia({ loaderData, actionData }: Route.ComponentProps) {
  const { media, maxBytes } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const missingAlt = media.filter((m) => !m.alt).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Pictures"
        subtitle={
          <>
            The club's own photographs, for use on your{" "}
            <Link to="/app/site" className="underline underline-offset-4">
              website
            </Link>
            . A real photograph of your club, badly lit, beats a good one of strangers.
          </>
        }
      />

      {actionData && "error" in actionData && actionData.error && (
        <p className="mb-6 rounded-lg border border-risk-500/30 bg-risk-500/5 px-4 py-3 text-sm text-ink-800 dark:text-ink-200">
          {actionData.error}
        </p>
      )}

      <Card className="mb-6">
        <Form method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-4">
          <input type="hidden" name="intent" value="upload" />
          <div className="min-w-56 flex-1">
            <Field
              label="Add a picture"
              name="file"
              hint={`JPEG, PNG, WebP, AVIF or GIF, up to ${MB(maxBytes)}.`}
            >
              <Input id="file" type="file" name="file" accept={ALLOWED_IMAGE_TYPES.join(",")} required />
            </Field>
          </div>
          <div className="min-w-56 flex-1">
            <Field
              label="What's in it"
              name="alt"
              hint="One short sentence, for anybody using a screen reader."
            >
              <Input id="alt" name="alt" placeholder="Members packing food parcels in the church hall" />
            </Field>
          </div>
          <Button disabled={busy}>{busy ? "Uploading…" : "Upload"}</Button>
        </Form>
      </Card>

      {missingAlt > 0 && (
        <p className="mb-6 rounded-lg border border-watch-500/30 bg-watch-500/5 px-4 py-3 text-sm text-ink-800 dark:text-ink-200">
          {missingAlt} picture{missingAlt === 1 ? " has" : "s have"} no description. Without one a
          screen reader skips {missingAlt === 1 ? "it" : "them"} in silence, which is better than
          reading out a filename but worse than a sentence.
        </p>
      )}

      {media.length === 0 ? (
        <Card>
          <p className="text-ink-600 dark:text-ink-400">
            Nothing here yet. Photographs of your own meetings and projects do more for a club page
            than any amount of writing.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((m) => (
            <Card key={m.id}>
              <img
                src={m.url}
                alt={m.alt ?? ""}
                loading="lazy"
                className="aspect-[4/3] w-full rounded-lg bg-ink-100 object-cover dark:bg-ink-800"
              />
              <p className="mt-3 truncate text-sm font-medium text-ink-800 dark:text-ink-200">
                {m.filename}
              </p>
              <p className="text-xs text-ink-500">
                {MB(m.bytes)} · added {formatDate(m.createdAt)}
              </p>
              <Form method="post" className="mt-3 flex gap-2">
                <input type="hidden" name="intent" value="alt" />
                <input type="hidden" name="mediaId" value={m.id} />
                <Input
                  name="alt"
                  defaultValue={m.alt ?? ""}
                  placeholder="What's in it"
                  className="text-sm"
                />
                <Button variant="secondary" className="shrink-0">
                  Save
                </Button>
              </Form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
