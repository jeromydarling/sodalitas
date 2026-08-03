-- 0004_payments.sql — online payment settings, checkout intents, webhook ledger.
--
-- Design note, because it constrains everything downstream: Sodalitas never
-- holds a club's money. Each club connects its own Stripe account and charges
-- are created directly on it, so dues and donations land in the club's own bank
-- account and the club's own Stripe dashboard. We take no application fee — the
-- product is paid for by subscription, not by a cut of a club's dues. That also
-- keeps us well clear of holding other people's charitable funds, which is a
-- place a small SaaS should not be.

CREATE TABLE payment_settings (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id            TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- The club's own Stripe account (acct_…), obtained through Connect OAuth.
  -- Null means online payment is simply off for this club.
  stripe_account_id  TEXT,
  -- Stripe's own answer to "can this account take money yet". A freshly
  -- connected account often can't until onboarding is finished, and showing a
  -- Donate button that 400s is worse than showing none.
  charges_enabled    INTEGER NOT NULL DEFAULT 0,
  currency           TEXT NOT NULL DEFAULT 'usd',
  dues_online        INTEGER NOT NULL DEFAULT 1,
  donations_enabled  INTEGER NOT NULL DEFAULT 0,
  donation_blurb     TEXT,
  -- JSON array of cents, e.g. [2500,5000,10000]. Suggested, never enforced.
  suggested_amounts  TEXT,
  -- Whether the "add the processing fee" box starts ticked. Ticked by default
  -- because most donors say yes when asked plainly, and unticked is a quiet
  -- 3% tax on the club.
  cover_fee_default  INTEGER NOT NULL DEFAULT 1,
  connected_at       TEXT,
  connected_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (tenant_id, club_id)
);
CREATE INDEX idx_payment_settings_club ON payment_settings(tenant_id, club_id);

-- A checkout we started. Written before the payer leaves for Stripe, so an
-- abandoned payment is visible as an abandoned payment rather than as nothing
-- at all — which is the difference between "the link is broken" and "they
-- changed their mind", and a treasurer chasing the wrong one wastes an evening.
CREATE TABLE checkout_sessions (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id           TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,            -- dues | donation
  invoice_id        TEXT REFERENCES dues_invoices(id) ON DELETE SET NULL,
  person_id         TEXT REFERENCES people(id) ON DELETE SET NULL,
  -- A donor may be a complete stranger. We keep what they typed rather than
  -- inventing a CRM record for someone who gave $25 once.
  donor_name        TEXT,
  donor_email       TEXT,
  amount_cents      INTEGER NOT NULL,         -- what the club receives
  fee_cents         INTEGER NOT NULL DEFAULT 0,
  covered_fee       INTEGER NOT NULL DEFAULT 0,
  charged_cents     INTEGER NOT NULL,         -- what the card is charged
  stripe_session_id TEXT,
  stripe_account_id TEXT,
  status            TEXT NOT NULL DEFAULT 'open', -- open | complete | expired | failed
  completed_at      TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (tenant_id, stripe_session_id)
);
CREATE INDEX idx_checkout_club ON checkout_sessions(tenant_id, club_id, status);
CREATE INDEX idx_checkout_invoice ON checkout_sessions(tenant_id, invoice_id);

-- `payments.kind` gains one value here: 'refund', carrying a negative
-- amount_cents. A refund is recorded as its own row rather than by editing or
-- deleting the original, so the club's history says what actually happened
-- instead of quietly rewriting itself. No schema change is needed — the column
-- has no CHECK constraint — but the vocabulary is written down here so the next
-- person reading 0001's comment doesn't conclude 'refund' is a bug.

-- Webhook idempotency. Stripe retries, and it is explicit that a handler must
-- tolerate seeing the same event twice. INSERT OR IGNORE on the provider's own
-- event id makes "have I already applied this?" a single atomic write instead of
-- a read-then-write race between two concurrent deliveries.
--
-- Global on purpose: the event arrives before we know whose it is.
CREATE TABLE webhook_events (
  id           TEXT PRIMARY KEY,   -- the provider's event id, e.g. evt_…
  provider     TEXT NOT NULL,
  type         TEXT NOT NULL,
  account_id   TEXT,
  handled      INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  received_at  TEXT NOT NULL
);
CREATE INDEX idx_webhook_recent ON webhook_events(provider, received_at);
