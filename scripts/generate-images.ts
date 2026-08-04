/**
 * generate-images.ts — fill the image slots with Workers AI.
 *
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run images
 *
 * Reads content/media.ts, generates anything missing, and writes it to
 * app/media/. Slots that already have a file are skipped, so re-running it is
 * cheap and safe — pass --force to regenerate, or a slot key to do just one:
 *
 *   npm run images -- home-hero
 *   npm run images -- --force home-hero retention-hero
 *
 * ## Why this is a script and not a binding
 *
 * The `AI` binding proxies to Cloudflare even in local development, so
 * declaring it in wrangler.jsonc makes `npm run dev` require an API token —
 * which means a new contributor can't run the app at all until somebody
 * provisions them an account. Generating ahead of time keeps that door open:
 * the Worker has no AI dependency, the images are static assets, and nothing
 * about serving them is slower than serving a file.
 *
 * ## The token
 *
 * A token with **Workers AI: Read** is enough. Create one at
 * https://dash.cloudflare.com/profile/api-tokens. It is never read from a file
 * here and never written anywhere — pass it in the environment for the length
 * of one command.
 */

import { writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Explicit .ts extension: Node's type stripping resolves specifiers literally
// and will not guess an extension the way a bundler does.
import { MEDIA, promptFor, type MediaSlot } from "../content/media.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "app", "media");

/**
 * Text-to-image model.
 *
 * FLUX schnell: one-step, fast, and good enough at rooms and objects, which is
 * all these prompts ask for. Override with MODEL= if you want to try another.
 */
const MODEL = process.env.MODEL || "@cf/black-forest-labs/flux-1-schnell";

const SIZES: Record<MediaSlot["aspect"], { width: number; height: number }> = {
  "16/9": { width: 1280, height: 720 },
  // Banners and the hero backdrop. Wider than the model's comfortable range,
  // which is the point — a 21:9 frame forces a horizontal composition rather
  // than a square one with the sides cropped off by CSS later.
  "21/9": { width: 1536, height: 640 },
  "4/3": { width: 1024, height: 768 },
  "3/2": { width: 1200, height: 800 },
  "1/1": { width: 1024, height: 1024 },
};

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !token) {
    fail(
      "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.\n\n" +
        "  The token needs Workers AI: Read — create one at\n" +
        "  https://dash.cloudflare.com/profile/api-tokens\n\n" +
        "  Nothing here reads a token from a file. Pass it for one command:\n" +
        "    CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run images",
    );
  }

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const only = args.filter((a) => !a.startsWith("--"));

  await mkdir(OUT_DIR, { recursive: true });
  const existing = new Set(
    (await readdir(OUT_DIR).catch(() => [] as string[]))
      .filter((f) => /\.(webp|png|jpe?g|avif)$/.test(f))
      .map((f) => f.replace(/\.[^.]+$/, "")),
  );

  let wanted = MEDIA;
  if (only.length > 0) {
    const known = new Set(MEDIA.map((m) => m.key));
    const unknown = only.filter((k) => !known.has(k));
    if (unknown.length > 0) {
      fail(
        `No such slot: ${unknown.join(", ")}\n\n  Known slots:\n` +
          MEDIA.map((m) => `    ${m.key}  (${m.usedOn})`).join("\n"),
      );
    }
    wanted = MEDIA.filter((m) => only.includes(m.key));
  }

  const todo = force ? wanted : wanted.filter((m) => !existing.has(m.key));

  if (todo.length === 0) {
    console.log(
      `\n  Nothing to do — all ${wanted.length} slot(s) already have a file.` +
        `\n  Use --force to regenerate.\n`,
    );
    return;
  }

  console.log(`\n  ${MODEL}`);
  console.log(`  Generating ${todo.length} of ${MEDIA.length} slots into app/media/\n`);

  let made = 0;
  const failures: { key: string; reason: string }[] = [];

  // Sequential on purpose. Workers AI rate-limits per account, and a handful of
  // images is not worth the complexity of a concurrency pool that would mostly
  // be sitting in a backoff anyway.
  for (const slot of todo) {
    process.stdout.write(`  ${slot.key.padEnd(18)} `);
    try {
      const bytes = await generate(accountId, token, slot);
      await writeFile(join(OUT_DIR, `${slot.key}.png`), bytes);
      console.log(`✓ ${(bytes.length / 1024).toFixed(0)} KB`);
      made++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${reason}`);
      failures.push({ key: slot.key, reason });
    }
  }

  console.log(`\n  ${made} written to app/media/`);
  if (failures.length > 0) {
    // Named rather than summarised: a run that quietly says "3 failed" costs
    // somebody a second run to find out which three.
    console.log(`  ${failures.length} failed:`);
    for (const f of failures) console.log(`    ${f.key}: ${f.reason}`);
  }
  console.log(
    `\n  These are PNGs straight from the model. Before deploying, consider\n` +
      `  converting to WebP — <Media> picks up either extension:\n` +
      `    for f in app/media/*.png; do cwebp -q 82 "$f" -o "\${f%.png}.webp" && rm "$f"; done\n`,
  );
}

async function generate(accountId: string, token: string, slot: MediaSlot): Promise<Buffer> {
  const size = SIZES[slot.aspect];
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptFor(slot), ...size }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  const raw = await res.text();

  if (!res.ok) {
    let detail = raw.slice(0, 200);
    try {
      const parsed = JSON.parse(raw) as { errors?: { message?: string }[] };
      // Cloudflare's own message is the actionable one: an unentitled account,
      // a token missing Workers AI, a model name that has moved on.
      if (parsed.errors?.[0]?.message) detail = parsed.errors[0].message;
    } catch {
      // Keep the truncated body.
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  // FLUX returns base64 JSON; some image models return raw binary. Handle both
  // rather than pinning to one model's shape.
  try {
    const parsed = JSON.parse(raw) as { result?: { image?: string }; success?: boolean };
    const b64 = parsed.result?.image;
    if (!b64) throw new Error("no image in response");
    return Buffer.from(b64, "base64");
  } catch (err) {
    if (raw.startsWith("\x89PNG") || raw.startsWith("\xff\xd8")) {
      return Buffer.from(raw, "binary");
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
