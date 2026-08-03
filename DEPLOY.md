# Deploying Sodalitas

The Cloudflare resources already exist and `wrangler.jsonc` carries their real
IDs, so there is nothing to provision. What follows is everything between a
fresh clone and a working production URL.

| Resource | Name | ID |
|---|---|---|
| Worker | `sodalitas` | `d402330c0a714f2e9772f300d6547adb` |
| D1 | `sodalitas` | `67399404-a149-4afd-ac44-afc421ad9ae5` |
| KV | `sodalitas-kv` | `7d49d2691250486b98e813a0d4aaa977` |
| R2 | `sodalitas-media` | — |

Current URL: **https://sodalitas.jer-f84.workers.dev**

When a real domain is bought, change `APP_URL` in `wrangler.jsonc` and
`brand.domain` in `content/brand.ts`. Those two values feed every canonical
URL, `og:` tag, sitemap entry, `llms.txt` link and magic-link email, so they
are the only two places that need to know.

## 1. Authenticate

```sh
npx wrangler login          # interactive
# or, in CI:
export CLOUDFLARE_API_TOKEN=…
```

## 2. Apply the schema

The remote database is currently empty.

```sh
npm run db:migrate:remote
```

The script checks the migration numbering is gapless before it touches
anything, then hands off to `wrangler d1 migrations apply`, which keeps its own
ledger — so re-running is safe and only new files are applied.

## 3. Deploy

```sh
npm run deploy              # builds, then wrangler deploy
```

## 4. Check it came up

```sh
curl -s https://sodalitas.jer-f84.workers.dev/api/health
```

`integrations` reports which optional keys are present. All three being
`false` is the expected state on a first deploy and does not mean anything is
broken — see below.

Then look at the real pages:

```sh
curl -s https://sodalitas.jer-f84.workers.dev/ | grep -o "keep the members you have"
curl -s https://sodalitas.jer-f84.workers.dev/llms.txt | head -5
```

## 5. Seed the demo

The demo club is the best sales argument the product has, and an empty demo is
worse than none.

```sh
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" \
  https://sodalitas.jer-f84.workers.dev/api/ops/seed-demo

curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" \
  https://sodalitas.jer-f84.workers.dev/api/ops/run-job/nightly_snapshots

curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" \
  https://sodalitas.jer-f84.workers.dev/api/ops/run-job/weekly_signals
```

That produces a 46-member club with eight months of history, then scores it and
generates the week's signals. Its public page lands at `/club/lakeside`.

The weekly housekeeping cron re-seeds it, and self-heals if it is ever found
empty.

## Secrets

**Every one of these is optional.** The app runs end to end without a single
one: AI buttons explain they aren't switched on, mail is written to
`email_messages` with status `logged_only` and printed to the log — including
sign-in links, so you can log in with no mail provider at all — and payment
settings stay hidden. Add them when you want the feature, not before.

```sh
npx wrangler secret put ADMIN_TOKEN        # guards /api/ops/*  ← set this first
npx wrangler secret put IP_HASH_SECRET     # salts hashed IPs
npx wrangler secret put ANTHROPIC_API_KEY  # draft recaps and follow-ups
npx wrangler secret put RESEND_API_KEY     # outbound mail
npx wrangler secret put STRIPE_SECRET_KEY  # dues and donations
npx wrangler secret put STRIPE_CONNECT_CLIENT_ID
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Three of those deserve a note:

**`ADMIN_TOKEN`** guards `/api/ops/*`. While it is unset those endpoints are
reachable only from localhost, so a deployed Worker without it exposes nothing
— but you need it set before you can seed the demo remotely. Set it first.

**`IP_HASH_SECRET`** salts the IP hashes used in rate-limit keys and audit rows.
Without it a development default is used. Hashing the entire IPv4 space takes
about a second, so an unsalted "anonymised" IP is not anonymous — set a long
random value in production.

**The three Stripe values** work together and each does a different job.
`STRIPE_SECRET_KEY` lets us call the API at all. `STRIPE_CONNECT_CLIENT_ID`
(`ca_…`, from the Connect settings page) is what a treasurer is sent to when
they link the club's own Stripe account — without it the Link button doesn't
appear, and a club with an already-linked account keeps working.
`STRIPE_WEBHOOK_SECRET` is the load-bearing one: a signed webhook is the *only*
thing in the product that marks money as received, and without a secret to
verify against, the endpoint rejects every delivery rather than trusting an
unsigned body. Point the Stripe endpoint at `/api/stripe/webhook` and subscribe
it to `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.expired` and `charge.refunded` — **including events from
connected accounts**, since every charge happens on a club's own account.

## Payments, and whose money it is

Sodalitas never holds a club's money. Each club connects its own Stripe account
through Connect, charges are created directly on that account, and we take no
application fee — the product is paid for by subscription, not by a slice of
anybody's dues. Dues and donations land in the club's own bank account, in the
club's own Stripe dashboard, under the club's own tax identity.

That is worth saying out loud to a treasurer, and it also keeps us clear of
holding charitable funds, which is not a place a small SaaS belongs.

## Cron

Four schedules are declared in `wrangler.jsonc` and register on deploy. All UTC:

| When | Job | What it does |
|---|---|---|
| `0 5 * * *` | `nightly_snapshots` | Scores every club and member; moves memberships in and out of `at_risk` |
| `15 6 * * 1` | `weekly_signals` | Turns last night's scores into the week's list, and into tasks |
| `*/15 * * * *` | `outbound_drain` | Sends queued mail |
| `0 4 * * 0` | `housekeeping` | Expires sessions, resets the demo |

Every run writes to `job_runs` whether it succeeds or fails, so a job silently
stopping three weeks ago is something you find on a dashboard rather than from
a district governor. Check it with:

```sh
curl -s -H "X-Admin-Token: $ADMIN_TOKEN" \
  https://sodalitas.jer-f84.workers.dev/api/ops/jobs
```

Signals are deduped by key and snapshots are keyed on (club, date), so any job
is safe to re-run by hand after a failure — it repairs the gap rather than
doubling the data.

## Mail domain

Until a sending domain is verified, everything degrades to logs and the product
still works. When you're ready, verify the domain with the provider, set
`RESEND_API_KEY`, and point `MAIL_FROM` / `MAIL_REPLY_TO` in `wrangler.jsonc`
at an address on it. `MAIL_REPLY_TO` should be somewhere a human reads — a
member replying to a meeting reminder is doing exactly the right thing.
