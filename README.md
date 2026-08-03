# Sodalitas

A club operating system for Rotary and Rotaract — built for how clubs and
districts actually work: federated, volunteer-run, and turning over their
leadership every July.

## Where things are

```
app/          React Router v8 routes and UI (SSR)
worker/       Hono API at /api/*, cron handlers, the Worker entry point
db/           Migrations, the table registry, and the tenant-scoped data layer
domain/       Business logic — roles, scoring, signals, sanitisers. Pure and tested.
content/      Marketing copy, guides registry, comparison data
ai/           Provider abstraction and versioned prompts
emails/       Templates
reference/    The CROS codebase this app draws from. Not built, not deployed.
```

`reference/cros/` is the Lovable/Supabase application Sodalitas is derived from.
It is excluded from build, typecheck, lint and test. It is here so logic can be
ported deliberately and diffed against the original, and it goes away once the
port is finished.

## Running it

```sh
npm install
npm run db:migrate:local     # apply migrations to the local D1
npm run dev
```

`npm run dev` serves the app through the Cloudflare Vite plugin, so D1, KV, R2
and the AI binding behave locally the way they do in production.

## The rules this codebase holds itself to

**The tenant boundary is code, not configuration.** D1 has no row-level
security. Every tenant-owned table is reached through `TenantDb` in
`db/scope.ts`, which binds one tenant id and refuses to build a query without
it. The escape hatch for joins requires a `{{tenant}}` token in the SQL. Tests
in `db/scope.test.ts` parse the migrations and fail if a new table with a
`tenant_id` column isn't registered.

**Money is integer cents.** Everywhere, without exception.

**Scores are deterministic.** Club health and member engagement are rules-based
and carry the drivers that produced them. AI may explain a score. It may never
produce one.

**Nothing contacts anyone on its own.** Signals become suggestions. A human
sends the email.

**Every integration degrades clean.** No Stripe key, no email key, no AI key —
the app still runs end to end, with a friendly note where the feature would be.
You should be able to use Sodalitas fully before adding a single secret.

**Secrets are Worker secrets.** Never in the repo, never in a file, never in
chat. Referenced by name only.

## Testing

```sh
npm test          # vitest over db/, domain/, worker/, app/
npm run typecheck
```

Pure logic is tested directly: authority resolution, scoring, sanitisers,
validators, the content registry. Those tests are the ones that catch real bugs.
