# Sodalitas

A club operating system for Rotary and Rotaract — built for how clubs and
districts actually work: federated, volunteer-run, and turning over their
leadership every July.

Derived from CROS, rebuilt on Cloudflare Workers with D1, R2 and KV.

**Live:** https://sodalitas.jer-f84.workers.dev · **Deploying:** [DEPLOY.md](./DEPLOY.md)

> ⚠️ **Open credential rotation.** A file of live CROS federation secrets was
> committed to this public repository's initial commit. It has been removed from
> the tree, but the values remain in history and must be treated as compromised.
> See [SECURITY-ROTATION.md](./SECURITY-ROTATION.md) — rotation has not been done.

## What it does

Keeps the roster, runs the meetings, and tells you which members are drifting
while there is still time to do something about it.

That last part is the point. Members rarely quit a Rotary club — they miss a
meeting, then a month, and somebody notices in July. Software that only records
who is a member is software that records the decline. This scores member
engagement and club health from what a club already writes down, and produces a
short weekly list of specific people to contact and why.

## Where things are

```
app/          React Router v8 routes and UI (SSR)
worker/       Hono API at /api/*, cron jobs, the Worker entry point
db/           Migrations, the table registry, the tenant-scoped data layer, services
domain/       Business logic — roles, scoring, signals, sanitisers, CSV, pricing
content/      Brand, voice and copy registries
emails/       Templates and the send adapter
ai/           Provider abstraction and versioned prompts
reference/    The CROS codebase this is derived from. Not built, not deployed.
```

`domain/` is pure — facts in, answers out, no database and no clock. That is
what lets the judgements be tested directly and the queries be optimised
without touching them.

`reference/cros/` is the Lovable/Supabase application Sodalitas came from,
excluded from build, typecheck, lint and test. It is here so logic can be
ported deliberately and diffed against the original, and goes away when the
port is finished.

## Running it

```sh
npm install
npm run db:migrate:local
npm run dev
```

Then, with the dev server up, seed a club worth looking at:

```sh
curl -X POST http://localhost:5173/api/ops/seed-demo
curl -X POST http://localhost:5173/api/ops/run-job/nightly_snapshots
curl -X POST http://localhost:5173/api/ops/run-job/weekly_signals
```

That builds a 46-member club with eight months of attendance, guests,
committees, projects and dues, then scores it and generates the week's signals.
Its public page is at `/club/lakeside`. `/api/ops/*` is localhost-only until
`ADMIN_TOKEN` is set.

You can sign in with no keys configured at all: mail degrades to the console,
so the sign-in link is printed in the dev server's output.

## The rules this codebase holds itself to

**The tenant boundary is code, not configuration.** D1 has no row-level
security. Every tenant-owned table is reached through `TenantDb` in
`db/scope.ts`, which binds one tenant id, refuses inserts carrying a foreign
one, and requires a `{{tenant}}` token in raw SQL. Tests parse the migrations
and fail if a table with a `tenant_id` column isn't registered. The single
sanctioned cross-tenant read — resolving a public club page by slug — lives
alone in `db/publicLookup.ts` so the complete list of them stays one screen
long.

**Money is integer cents.** Everywhere, from `domain/pricing.ts` outward.

**Scores are deterministic and explain themselves.** Club health and member
engagement are rules over recorded facts, and every score carries the drivers
that produced it with points earned against points available. AI may explain a
score. It may never produce one.

**Nothing contacts anyone on its own.** Signals become suggestions and tasks. A
human presses send.

**Every integration degrades clean.** No Stripe key, no mail key, no AI key —
the app still runs end to end. You should be able to use Sodalitas fully before
adding a single secret, and that is tested rather than assumed.

**Secrets are Worker secrets.** Never in the repo, never in a file, never in
chat.

## The judgements

Some behaviour is deliberate and easy to "fix" into being wrong. These are
pinned in tests:

- A club that has recorded nothing is not a failing club. It reads "not enough
  recorded yet", not "at risk".
- A member on approved leave is never flagged. They told us.
- Honorary and corporate members aren't held to weekly attendance.
- A member six weeks in has no history by definition, and flagging them is a
  bad welcome as well as a wrong answer.
- "At risk" means two different things and gets two different messages: someone
  who has stopped coming needs a phone call; someone who attends every week but
  is on no committee needs a job to do.
- The weekly list caps at seven. Forty signals is a backlog, and a backlog gets
  closed rather than worked.
- Spam on a public form gets the same friendly thank-you as a real enquiry.

## Testing

```sh
npm test
npm run typecheck
```

354 tests. The ones that matter are over pure logic — authority resolution,
scoring, signal generation, the Communio sanitiser, CSV parsing, pricing, spam
scoring — plus the voice tests over email templates and AI prompts, which exist
because copy drifts and email is where drift costs most.
