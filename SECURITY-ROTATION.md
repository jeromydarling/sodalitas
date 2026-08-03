# Credentials to rotate

**Status: open. Rotation has not been done, and cannot be done from this
repository — it needs access to Stripe and to the Lovable projects.**

## What happened

`reference/cros/.claude-handoff/secrets/` held two files of live credentials in
plaintext. They were committed in this repository's **initial commit** and this
repository is **public**, so the values have been readable by anyone on the
internet since the repository was created.

The files have now been deleted from the working tree, and `.gitignore` has been
widened so nothing shaped like them can come back. **Neither of those undoes the
exposure.** Deleting a file removes it from the tip, not from history — every
value below is still fetchable from the initial commit by anyone who clones the
repository, and quite possibly from GitHub's own caches and from forks and
mirrors, indefinitely.

Treat all of them as compromised.

## What to rotate

Values are not reproduced here. If you need to match old to new during the
cutover, they are in the initial commit — at the repository root back then,
before CROS moved under `reference/`:

```sh
git show 5a1ff01:.claude-handoff/secrets/federation_stripe_secrets.env
git show 5a1ff01:.claude-handoff/secrets/hub_webhook_secrets.env
```

(`.claude-handoff/prompts/claude_code_distribute_federation_secrets.md` from the
same commit describes the distribution procedure and contains no values.)

### 1. Federation HMAC secrets — highest priority

`federation_stripe_secrets.env`, generated 2026-07-27. One shared HMAC secret
per satellite, each stored twice: as `FEDERATION_STRIPE_SECRET_<NAME>` on the
hub (`thecros`) and as `FEDERATION_STRIPE_SECRET` on the satellite.

Four pairs: **resurrectio**, **vigilia**, **rehearso**, **theschola**.

These are what the hub and each satellite use to prove forwarded Stripe events
are genuine. Anyone holding one can forge a signed event to that satellite —
which, depending on what the satellite does with billing events, means granting
entitlements or marking things paid that were never paid for.

Rotate hub-side and satellite-side together, one satellite at a time, since a
mismatched pair rejects every event in between.

### 2. Stripe hub webhook signing secrets

`hub_webhook_secrets.env`: `STRIPE_HUB_PLATFORM_WEBHOOK_SECRET` and
`STRIPE_HUB_CONNECT_WEBHOOK_SECRET`, both test-mode, plus the two endpoint ids
(`we_…`) they belong to.

Roll each in the Stripe dashboard under the endpoint's own settings, then update
the value in Lovable Cloud → thecros → Secrets. The endpoint ids are not secret;
they are only there to identify which endpoint is which.

Test-mode secrets can't move real money, which lowers the severity — but they
still let someone forge test events into a live system, and the same file layout
will hold live values at cutover. Roll them.

### 3. Check Stripe's own alerts

GitHub scans public repositories for `whsec_` and `sk_` patterns and notifies
Stripe. There may already be a notice in the Stripe dashboard. Worth reading
rather than dismissing — it tells you when the value was first seen public.

## Not secrets, despite appearances

- `reference/cros/.env` — `VITE_SUPABASE_PUBLISHABLE_KEY` and friends. Anon /
  publishable keys are designed to be shipped in a browser bundle and are public
  by construction. Row-level security is what protects that data, not the key.
- `reference/cros/src/pages/Unsubscribe.tsx` — a hardcoded Supabase anon key,
  same reasoning.

Both are fine where they are. Worth knowing so the real items above don't get
lost among them.

## Purging the history

The values stay in this repository's history until the history is rewritten. That
means a force-push to `main` of a public repository, which is destructive and
rewrites every commit hash — so it is **not** something to do without deciding to.

If you want it:

```sh
# git-filter-repo, not filter-branch — filter-branch is slow and gets this wrong.
pip install git-filter-repo
# Both paths: the directory moved under reference/ in commit 69c0b61.
git filter-repo --force --invert-paths \
  --path .claude-handoff/secrets \
  --path reference/cros/.claude-handoff/secrets
git push --force origin main
```

Then ask GitHub Support to expire the cached views of the old commits, since they
remain reachable by SHA for a while afterwards. Any fork or existing clone keeps
its own copy regardless.

**Rewriting history is not a substitute for rotating.** Rotate first; the rewrite
is tidying up afterwards. If you only do one, do the rotation.
