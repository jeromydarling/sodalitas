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

The nightly housekeeping cron re-seeds it, and self-heals if it is ever found
empty.

### Signing in to it

`/demo` has a button that mints a session as `demo@sodalitas.app`, a seeded
account holding **Club President** plus the two import capabilities. No sign-up,
no email address, no password — the account has no password hash at all, so it
cannot be used from the ordinary sign-in form.

The entry point is a POST. A GET would hand a session to every link prefetcher
and mail scanner that touched the URL, and React Router's own `prefetch="intent"`
would do it on hover.

### What is switched off in there, and why

Anyone on the internet can sign in, which makes every outward-facing action a
gift to whoever finds it. Three are refused by `requireNotDemo` in
`worker/context.ts`:

- **Inviting an officer by email** — would send mail to any address a stranger
  typed. Unguarded, this is an open relay attached to a real sending domain.
- **Card payments** — would create real Stripe checkouts.
- **Posting to Communio** — groups deliberately span tenants, so anything posted
  from the demo lands in front of real clubs.

Behind that sits a second layer: `sendEmail` refuses outright for any tenant
flagged `is_demo`, and **fails closed** — if it cannot determine whether a
tenant is the demo, it does not send. The guard covers the actions we know
about; the backstop covers whatever gets added later by somebody who didn't
know the rule.

Everything that stays inside the club works normally: adding members, recording
attendance, billing dues, running an import, breaking things. It is all rebuilt
at 04:00 UTC.

## Secrets

**Every one of these is optional.** The app runs end to end without a single
one: AI buttons explain they aren't switched on, mail is written to
`email_messages` with status `logged_only` and printed to the log — including
sign-in links, so you can log in with no mail provider at all — and payment
settings stay hidden. Add them when you want the feature, not before.

Outbound mail is **not** in this list: it goes through the Cloudflare Email
Service binding, which needs no secret. `RESEND_API_KEY` is only a fallback for
deployments that can't use it. See [Mail](#mail).

```sh
npx wrangler secret put ADMIN_TOKEN        # guards /api/ops/*  ← set this first
npx wrangler secret put IP_HASH_SECRET     # salts hashed IPs
npx wrangler secret put ANTHROPIC_API_KEY  # draft recaps and follow-ups
npx wrangler secret put RESEND_API_KEY     # mail fallback only — see "Mail" below
npx wrangler secret put STRIPE_SECRET_KEY  # dues and donations
npx wrangler secret put STRIPE_CONNECT_CLIENT_ID
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put CF_API_TOKEN        # clubs' own domains — see "Custom domains"
npx wrangler secret put CF_ZONE_ID
```

Most are self-explanatory. These deserve a note:

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

**`CF_API_TOKEN` and `CF_ZONE_ID`** are what let clubs point their own domain at
their site. They need more setup than a `secret put`, so they have their own
section below.

## Payments, and whose money it is

Sodalitas never holds a club's money. Each club connects its own Stripe account
through Connect, charges are created directly on that account, and we take no
application fee — the product is paid for by subscription, not by a slice of
anybody's dues. Dues and donations land in the club's own bank account, in the
club's own Stripe dashboard, under the club's own tax identity.

That is worth saying out loud to a treasurer, and it also keeps us clear of
holding charitable funds, which is not a place a small SaaS belongs.

## Custom domains

Clubs can serve their public site at their own address —
`rotaryclubofsomewhere.org` rather than ours. It runs on Cloudflare for SaaS,
and it needs two things set once.

**`CF_ZONE_ID`** is the zone clubs CNAME into. It has to be a zone on this
Cloudflare account with Cloudflare for SaaS enabled, and its fallback origin
has to point at this Worker — the setup is in the dashboard under
SSL/TLS → Custom Hostnames, and the
[Workers as your fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/)
guide is the one to follow: an originless `AAAA 100::` record plus a `*/*`
Worker route.

**`CF_API_TOKEN`** needs one permission — **SSL and Certificates: Edit** on
that zone. Nothing else. It is used only to create, read and delete custom
hostnames.

Optionally set `SITE_CNAME_TARGET` as a plain var in `wrangler.jsonc` — it is
what a club types into their registrar. It defaults to the Worker's own
hostname, which works but reads oddly on a DNS control panel; something like
`sites.sodalitas.app` is what you want a treasurer to be copying.

**Until all of that exists, the feature runs dark and nothing breaks.** A club
can add their address, see the exact record to create, and save it. The row sits
at `pending`, the quarter-hourly cron registers it the moment the credentials
land, and the club is not told anything untrue in the meantime.

One boundary worth knowing about: a request arriving on a hostname that is not
ours is resolved to a club and then rewritten under `/club/<slug>`. Everything
is rewritten, which means `/login` and `/app/people` on a club's domain resolve
to pages that do not exist. A club's domain cannot serve the application, and
that is a property of the routing rather than a list of blocked paths — a new
app route cannot accidentally become reachable there.


## Cron

Four schedules are declared in `wrangler.jsonc` and register on deploy. All UTC:

| When | Job | What it does |
|---|---|---|
| `0 5 * * *` | `nightly_snapshots` | Scores every club and member; moves memberships in and out of `at_risk` |
| `15 6 * * 1` | `weekly_signals` | Turns last night's scores into the week's list, and into tasks |
| `*/15 * * * *` | `outbound_drain` | Sends queued mail; publishes pages scheduled for now; re-checks custom domains waiting on DNS |
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

## Mail

Outbound mail goes through **Cloudflare Email Service** via the `EMAIL` binding
declared in `wrangler.jsonc`. There is no secret to set — the binding either
exists or it doesn't — and Cloudflare handles DKIM and ARC signing.

Three transports, chosen by what's available (`mailProvider` in
`emails/send.ts` is the one place that decides):

1. **Cloudflare Email Service** — the `EMAIL` binding. Preferred.
2. **Resend** — used only if there's no binding and `RESEND_API_KEY` is set.
   Kept because Email Sending requires the domain to be on Cloudflare DNS, and
   not every deployment will be.
3. **Nothing** — writes to `email_messages` with status `logged_only` and
   prints the body. A fresh checkout can sign in with no mail account anywhere.

### Onboarding the sending domain

Email Sending needs the domain onboarded before it will deliver to arbitrary
recipients. Until then Cloudflare only accepts sends to addresses **verified on
the account**, and anything else fails with `E_SENDER_NOT_VERIFIED` or
`E_RECIPIENT_NOT_ALLOWED` — both of which are translated into plain English in
`email_messages.error` rather than stored as a bare code.

1. The domain must use Cloudflare DNS, and the account must be on Workers Paid.
2. Dashboard → **Compute → Email Service → Email Sending → Onboard Domain**.
   Cloudflare adds MX, SPF, DKIM and DMARC records on a `cf-bounce` subdomain.
3. Point `MAIL_FROM` and `MAIL_REPLY_TO` in `wrangler.jsonc` at an address on
   that domain, and update `allowed_sender_addresses` on the `send_email`
   binding to match — it pins what this Worker may send *from*.

`MAIL_REPLY_TO` should be somewhere a human reads. A member replying to a
meeting reminder is doing exactly the right thing.

> `MAIL_FROM` is currently `hello@sodalitas.app`. Sending will fail until that
> domain is onboarded — a `workers.dev` subdomain cannot be a sender.

### Local development

`wrangler dev` simulates the binding: nothing is delivered, each message is
written under `.wrangler/tmp/email/`, and the body is also printed to the
console so sign-in links stay copy-pasteable. Add `"remote": true` to the
`send_email` binding to send real mail from a local run — real mail to real
people, so use a test address.

### Bounces and complaints

Not wired up yet. Cloudflare can publish `message.bounced` and
`message.complained` events to a Queue, which is the natural way to feed
`email_suppressions` automatically. Today a hard bounce is only suppressed
account-wide by Cloudflare, and this app won't know about it.
