-- 0002_intelligence.sql — health scoring, signals, sharing, email, import.
--
-- This is the layer that makes Sodalitas different from a directory. Two rules
-- govern all of it, both inherited from CROS and both non-negotiable:
--
--   1. Scores are deterministic and rules-based. AI may explain a score; it may
--      never produce one. Every score carries the drivers that made it.
--   2. Nothing here auto-contacts anyone. Signals become suggestions; a human
--      sends the email.

-- ── Club health ───────────────────────────────────────────────────────────────
-- Materialised nightly rather than computed per request — a district dashboard
-- reading 40 clubs cannot afford 40 live aggregations.
CREATE TABLE club_health_snapshots (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id         TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  as_of           TEXT NOT NULL,          -- YYYY-MM-DD
  score           INTEGER NOT NULL,       -- 0–100
  status          TEXT NOT NULL,          -- healthy | watch | at_risk
  -- The inputs, stored so the number is inspectable a year later even if the
  -- weights change. A score you cannot explain is a score nobody trusts.
  drivers         TEXT NOT NULL,          -- JSON array of {key,label,value,points,max}
  member_count    INTEGER NOT NULL DEFAULT 0,
  net_change_90d  INTEGER NOT NULL DEFAULT 0,
  attendance_rate REAL,
  active_prospects INTEGER NOT NULL DEFAULT 0,
  dues_delinquent_pct REAL,
  version         TEXT NOT NULL DEFAULT 'v1',
  created_at      TEXT NOT NULL,
  UNIQUE (club_id, as_of)
);
CREATE INDEX idx_health_tenant ON club_health_snapshots(tenant_id, as_of);
CREATE INDEX idx_health_status ON club_health_snapshots(tenant_id, status, as_of);

-- Per-member engagement, same philosophy. This is what raises an at-risk flag,
-- and the drivers are what the membership chair reads before reaching out.
CREATE TABLE member_engagement (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id         TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  person_id       TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  membership_id   TEXT REFERENCES memberships(id) ON DELETE CASCADE,
  as_of           TEXT NOT NULL,
  score           INTEGER NOT NULL,
  risk_level      TEXT NOT NULL,          -- steady | watch | at_risk
  drivers         TEXT NOT NULL,          -- JSON
  last_attended_on TEXT,
  attendance_rate_90d REAL,
  last_touch_on   TEXT,
  committee_count INTEGER NOT NULL DEFAULT 0,
  project_count   INTEGER NOT NULL DEFAULT 0,
  dues_current    INTEGER NOT NULL DEFAULT 1,
  version         TEXT NOT NULL DEFAULT 'v1',
  created_at      TEXT NOT NULL,
  UNIQUE (person_id, club_id, as_of)
);
CREATE INDEX idx_engagement_risk ON member_engagement(tenant_id, club_id, risk_level, as_of);
CREATE INDEX idx_engagement_person ON member_engagement(tenant_id, person_id, as_of);

-- ── Signals ───────────────────────────────────────────────────────────────────
-- Ported from CROS's nri_story_signals. Deterministic generation, evidence
-- attached, deduped by key so a weekly job is safe to re-run. Every signal is
-- dismissible by a human and records why it fired.
CREATE TABLE signals (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id      TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  person_id    TEXT REFERENCES people(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  -- at_risk | guest_follow_up | reconnect | celebration | milestone
  -- | dues_overdue | leadership_gap | club_watch | anniversary
  severity     TEXT NOT NULL DEFAULT 'info',  -- info | notice | urgent
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  -- The "why am I seeing this?" payload. JSON. Never omitted.
  evidence     TEXT NOT NULL,
  suggested_action TEXT,
  dedupe_key   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',  -- open | acted | dismissed | expired
  acted_at     TEXT,
  dismissed_at TEXT,
  dismissed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  dismiss_reason TEXT,
  generator    TEXT NOT NULL DEFAULT 'rules', -- rules | manual (never 'ai')
  version      TEXT NOT NULL DEFAULT 'v1',
  created_at   TEXT NOT NULL,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX idx_signals_open ON signals(tenant_id, status, severity, created_at);
CREATE INDEX idx_signals_club ON signals(tenant_id, club_id, status);
CREATE INDEX idx_signals_person ON signals(tenant_id, person_id, status);

-- ── Communio: cross-club sharing ──────────────────────────────────────────────
-- Clubs opt into groups; groups exchange sanitised signals, events and asks.
-- The sanitiser (domain/communio.ts) refuses anything carrying member PII, so a
-- club can share "attendance is recovering" without exposing who attended.
CREATE TABLE communio_groups (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  scope         TEXT NOT NULL DEFAULT 'district', -- district | zone | interest | region
  created_by_tenant TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visibility    TEXT NOT NULL DEFAULT 'invite',   -- invite | open
  created_at    TEXT NOT NULL
);

CREATE TABLE communio_memberships (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES communio_groups(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id       TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  sharing_level TEXT NOT NULL DEFAULT 'summary',  -- none | summary | full
  created_at    TEXT NOT NULL,
  UNIQUE (group_id, tenant_id, club_id)
);
CREATE INDEX idx_communio_memberships_tenant ON communio_memberships(tenant_id);

CREATE TABLE communio_shared_signals (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES communio_groups(id) ON DELETE CASCADE,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id        TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  signal_type    TEXT NOT NULL,
  signal_summary TEXT NOT NULL,          -- sanitised, <= 180 chars, no PII
  -- Bucketed to the week, not the instant — a precise timestamp is itself a
  -- fingerprint when a group is small.
  week_start     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_shared_signals_group ON communio_shared_signals(group_id, created_at);

CREATE TABLE communio_shared_events (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES communio_groups(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meeting_id  TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  summary     TEXT,
  occurs_on   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_shared_events_group ON communio_shared_events(group_id, occurs_on);

-- Speakers a club will vouch for. The single most-requested thing district
-- leaders ask each other for, and nobody has a list.
CREATE TABLE communio_speakers (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES communio_groups(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  topic         TEXT NOT NULL,
  bio           TEXT,
  contact_email TEXT,                  -- shared deliberately; this one is opt-in
  travel_radius TEXT,
  fee_note      TEXT,
  vouched_by_club TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_speakers_group ON communio_speakers(group_id, topic);

CREATE TABLE communio_requests (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES communio_groups(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id     TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  category    TEXT NOT NULL,           -- speaker | volunteers | advice | co_host | supplies
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_communio_requests_group ON communio_requests(group_id, status);

CREATE TABLE communio_replies (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES communio_requests(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_communio_replies_request ON communio_replies(request_id, created_at);

-- Anomaly flags raised by the governance scan: one club dominating a group,
-- volume spikes, sanitiser rejections trending up.
CREATE TABLE communio_governance_flags (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES communio_groups(id) ON DELETE CASCADE,
  tenant_id   TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  flag_type   TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'medium',
  details     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_gov_flags_open ON communio_governance_flags(status, created_at);

-- ── Email ─────────────────────────────────────────────────────────────────────
CREATE TABLE email_messages (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id       TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  direction     TEXT NOT NULL,          -- out | in
  template_key  TEXT,
  to_email      TEXT NOT NULL,
  from_email    TEXT NOT NULL,
  reply_to      TEXT,
  subject       TEXT NOT NULL,
  body_text     TEXT,
  body_html     TEXT,
  person_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  thread_key    TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  -- queued | sent | failed | logged_only | suppressed | received
  provider      TEXT,                   -- cloudflare | resend | none
  provider_id   TEXT,
  error         TEXT,
  sent_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_email_tenant ON email_messages(tenant_id, created_at);
CREATE INDEX idx_email_thread ON email_messages(tenant_id, thread_key, created_at);
CREATE INDEX idx_email_queue ON email_messages(status, created_at) WHERE status = 'queued';

-- Unsubscribes and bounces. Checked before every non-transactional send, no
-- exceptions, including for people a club insists it "has permission" for.
CREATE TABLE email_suppressions (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_norm  TEXT NOT NULL,
  reason      TEXT NOT NULL,           -- unsubscribed | bounced | complained | manual
  created_at  TEXT NOT NULL,
  UNIQUE (tenant_id, email_norm)
);

CREATE TABLE email_unsubscribe_tokens (
  token_hash  TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_norm  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- ── Import / migration ────────────────────────────────────────────────────────
-- The toolkit that wins against ClubRunner and DACdb. Every run is a dry-run
-- first, and every run is reversible until it is committed.
CREATE TABLE import_runs (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id        TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  source         TEXT NOT NULL,          -- csv | clubrunner | dacdb
  entity         TEXT NOT NULL,          -- people | memberships | attendance | payments
  filename       TEXT,
  r2_key         TEXT,
  mapping        TEXT,                   -- JSON column→field map
  mode           TEXT NOT NULL DEFAULT 'dry_run', -- dry_run | committed | rolled_back
  row_count      INTEGER NOT NULL DEFAULT 0,
  created_count  INTEGER NOT NULL DEFAULT 0,
  updated_count  INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  error_count    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',
  started_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  committed_at   TEXT,
  rolled_back_at TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_import_runs_tenant ON import_runs(tenant_id, created_at);

CREATE TABLE import_rows (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id        TEXT NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  row_number    INTEGER NOT NULL,
  raw           TEXT NOT NULL,           -- JSON of the source row
  action        TEXT,                    -- create | update | skip | error
  -- Set when this row would merge into an existing person, with the reason.
  match_person_id TEXT,
  match_reason  TEXT,
  entity_id     TEXT,                    -- populated on commit, enables rollback
  error         TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_import_rows_run ON import_rows(run_id, row_number);

-- ── Public join submissions ───────────────────────────────────────────────────
-- Public forms are spam magnets. We accept everything with the same friendly
-- "thanks!" and quietly drop what scores as spam, so bots never learn the rule.
CREATE TABLE join_submissions (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id      TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT,
  message      TEXT,
  referred_by  TEXT,
  status       TEXT NOT NULL DEFAULT 'new',   -- new | contacted | converted | spam
  spam_score   INTEGER NOT NULL DEFAULT 0,
  spam_reasons TEXT,
  person_id    TEXT REFERENCES people(id) ON DELETE SET NULL,
  ip_hash      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_join_club ON join_submissions(tenant_id, club_id, status, created_at);

-- ── Job health ────────────────────────────────────────────────────────────────
-- Every cron writes here. A dashboard nobody has to remember to check.
CREATE TABLE job_runs (
  id          TEXT PRIMARY KEY,
  job_key     TEXT NOT NULL,
  status      TEXT NOT NULL,            -- ok | error | skipped
  stats       TEXT,                     -- JSON
  error       TEXT,
  duration_ms INTEGER,
  started_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_job_runs_key ON job_runs(job_key, created_at);

-- ── AI audit ──────────────────────────────────────────────────────────────────
-- Every AI invocation, with the prompt version, the model, and whether a human
-- accepted the output. Required by the spec and by basic self-respect.
CREATE TABLE ai_invocations (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  feature        TEXT NOT NULL,          -- meeting_recap | followup_draft | risk_explain
  prompt_version TEXT NOT NULL,
  provider       TEXT NOT NULL,          -- anthropic | workers_ai | none
  model          TEXT NOT NULL,
  input_refs     TEXT,                   -- JSON — ids, never raw member data
  output         TEXT,
  accepted       INTEGER,                -- NULL until a human decides
  tokens_in      INTEGER,
  tokens_out     INTEGER,
  error          TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_ai_tenant ON ai_invocations(tenant_id, created_at);
CREATE INDEX idx_ai_feature ON ai_invocations(feature, created_at);
