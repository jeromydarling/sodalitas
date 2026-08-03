#!/usr/bin/env node
/**
 * migrate.mjs — apply D1 migrations locally or remotely.
 *
 * Thin wrapper over `wrangler d1 migrations apply`. Wrangler keeps its own
 * `d1_migrations` record table, so re-running is idempotent; this script exists
 * to (a) enforce the numbering convention before anything touches a database
 * and (b) give one command that works the same in both places.
 *
 *   npm run db:migrate:local
 *   npm run db:migrate:remote
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "db", "migrations");

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error("No migrations found in db/migrations.");
  process.exit(1);
}

// Numbered, zero-padded, snake_case, gapless. Enforced here so a mis-named file
// fails on a laptop instead of half-applying against production.
let expected = 1;
for (const f of files) {
  const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
  if (!m) {
    console.error(`Bad migration name: ${f}\nExpected NNNN_snake_case.sql`);
    process.exit(1);
  }
  const n = Number(m[1]);
  if (n !== expected) {
    console.error(`Migration numbering gap: expected ${String(expected).padStart(4, "0")}, found ${m[1]} (${f})`);
    process.exit(1);
  }
  expected++;
}

const remote = process.argv.includes("--remote");
const target = remote ? "--remote" : "--local";
console.log(`Applying ${files.length} migration(s) ${remote ? "to REMOTE D1" : "locally"}…`);

const res = spawnSync(
  "npx",
  ["wrangler", "d1", "migrations", "apply", "sodalitas", target],
  { stdio: "inherit", cwd: root },
);
process.exit(res.status ?? 1);
