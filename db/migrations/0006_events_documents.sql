-- 0006_events_documents.sql — event registration and ticketing, and the
-- document library. The two things the comparison page still conceded.
--
-- ## Events
--
-- Every club software has an events module and they are all the same island:
-- a registration list that knows nothing about the club it belongs to. A
-- fundraiser fills up, the module reports 84 tickets, and nobody ever finds
-- out that eleven of those were members who hadn't been to a meeting since
-- March, or that the four people who registered and didn't turn up are the
-- same four the retention score has been worried about since February.
--
-- So a registration here is a first-class event in the club's history. It
-- writes an interaction, it counts as involvement, and a no-show is a signal.
-- That is the part that cannot be copied by bolting Eventbrite onto a
-- membership database, and it is the reason this table lives beside `people`
-- rather than in a silo.
--
-- ## Money
--
-- Charges are direct on the club's own connected Stripe account, exactly like
-- dues and donations. Unlike dues and donations, a paid ticket carries a
-- platform application fee — small, capped, zero on free tickets, and stored
-- per registration so a treasurer can always see what was taken and by whom.
-- See domain/pricing.ts for the rate and app/routes/marketing/pricing.tsx for
-- where we say so out loud.

-- ── Events ────────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id       TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  -- Unique per club so the public URL is /club/<club>/events/<slug> and stays
  -- the same when the title gets edited the day before.
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT,
  description   TEXT,
  -- Local wall-clock date and time, plus the club's IANA zone. Deliberately
  -- not a UTC instant: "the auction is at 6pm" stays 6pm when the clocks
  -- change, which is what everyone means and what a UTC column gets wrong
  -- twice a year.
  starts_on     TEXT NOT NULL,
  starts_at_time TEXT,
  ends_on       TEXT,
  ends_at_time  TEXT,
  timezone      TEXT,
  location      TEXT,
  address       TEXT,
  map_url       TEXT,
  cover_media_id TEXT,
  -- 'draft' | 'open' | 'closed' | 'cancelled'. Closed keeps the page up and
  -- stops taking registrations; cancelled says so on the page, because a
  -- cancelled event that simply disappears leaves people turning up.
  status        TEXT NOT NULL DEFAULT 'draft',
  -- 'public' | 'members'. A members-only event is not listed on the club site.
  visibility    TEXT NOT NULL DEFAULT 'public',
  -- Overall seat count across every ticket type. Null means unlimited.
  capacity      INTEGER,
  waitlist      INTEGER NOT NULL DEFAULT 1,
  -- A Rotary-specific need every generic ticketing tool gets wrong: a member
  -- says "I'll bring three". Those three are guests of that member, not four
  -- separate registrations, and the club wants to know whose guests they were.
  allow_guests  INTEGER NOT NULL DEFAULT 1,
  max_guests    INTEGER NOT NULL DEFAULT 4,
  registration_opens_on TEXT,
  registration_closes_on TEXT,
  -- Shown at checkout and on the confirmation. A refund policy nobody was
  -- shown is a chargeback waiting to happen.
  refund_policy TEXT,
  -- Where the club's own project or committee this belongs to, if any.
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  committee_id  TEXT REFERENCES committees(id) ON DELETE SET NULL,
  published_at  TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (tenant_id, club_id, slug)
);
CREATE INDEX idx_events_club ON events(tenant_id, club_id, starts_on);
CREATE INDEX idx_events_upcoming ON events(tenant_id, status, starts_on);

-- ── Ticket types ──────────────────────────────────────────────────────────────
--
-- A separate table rather than a price on the event, because the shape a club
-- actually needs is "member $30, guest $35, table of eight $220" and any one
-- of those can sell out on its own.
CREATE TABLE event_ticket_types (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  -- Integer cents. Zero is a free ticket and takes no platform fee at all.
  price_cents   INTEGER NOT NULL DEFAULT 0,
  -- Seats this type may sell. Null means "share the event's capacity".
  capacity      INTEGER,
  -- How many seats one of these consumes. A table of eight is one ticket and
  -- eight seats, and getting that wrong oversells the room by seven.
  seats_each    INTEGER NOT NULL DEFAULT 1,
  max_per_order INTEGER NOT NULL DEFAULT 10,
  members_only  INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_ticket_types_event ON event_ticket_types(tenant_id, event_id, sort_order);

-- ── Questions ─────────────────────────────────────────────────────────────────
CREATE TABLE event_questions (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  help         TEXT,
  -- 'text' | 'choice' | 'checkbox'. Validated by domain/events.ts; a free
  -- string here would become an unrendered field on a public form.
  kind         TEXT NOT NULL DEFAULT 'text',
  options_json TEXT,
  required     INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_event_questions ON event_questions(tenant_id, event_id, sort_order);

-- ── Registrations ─────────────────────────────────────────────────────────────
CREATE TABLE event_registrations (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id       TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- Set when we can match the registrant to somebody the club knows. This is
  -- the join that makes an event part of the club's memory rather than a list
  -- of email addresses, so the service layer tries hard to fill it in.
  person_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  -- 'pending'  — checkout started, money not confirmed. Holds a seat briefly.
  -- 'confirmed'— coming.
  -- 'waitlist' — no seat; promoted automatically when one frees up.
  -- 'cancelled'— gave the seat back.
  -- 'attended' / 'no_show' — set at the door, and both are retention signals.
  status        TEXT NOT NULL DEFAULT 'pending',
  seats         INTEGER NOT NULL DEFAULT 1,
  guests        INTEGER NOT NULL DEFAULT 0,
  guest_names   TEXT,
  answers_json  TEXT,
  notes         TEXT,
  -- Money, all integer cents, all recorded per registration so a treasurer
  -- reconciling a Stripe payout never has to reverse-engineer any of it.
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  -- Stripe's card fee, if the registrant chose to cover it.
  covered_fee_cents INTEGER NOT NULL DEFAULT 0,
  -- Ours. Zero for free tickets. Stated on the page before anybody pays.
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  charged_cents INTEGER NOT NULL DEFAULT 0,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  checkout_id   TEXT REFERENCES checkout_sessions(id) ON DELETE SET NULL,
  -- Printed on the confirmation and turned into a QR code for the door. Not a
  -- secret — it identifies a booking, it does not authorise anything — so it
  -- is short enough to read down a phone line.
  ticket_code   TEXT NOT NULL,
  waitlist_position INTEGER,
  registered_at TEXT NOT NULL,
  confirmed_at  TEXT,
  cancelled_at  TEXT,
  checked_in_at TEXT,
  checked_in_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  ip_hash       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (tenant_id, event_id, ticket_code)
);
CREATE INDEX idx_registrations_event ON event_registrations(tenant_id, event_id, status);
CREATE INDEX idx_registrations_person ON event_registrations(tenant_id, person_id, registered_at);

-- What was actually bought. One row per ticket type in an order, so a booking
-- of "2 member + 1 guest" keeps its shape for the door list and the refund.
CREATE TABLE event_registration_items (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  registration_id  TEXT NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
  ticket_type_id   TEXT NOT NULL REFERENCES event_ticket_types(id) ON DELETE CASCADE,
  quantity         INTEGER NOT NULL DEFAULT 1,
  -- Copied at purchase. A club that changes the price next week must not
  -- change what somebody already paid.
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  seats_each       INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_reg_items ON event_registration_items(tenant_id, registration_id);

-- ── Documents ─────────────────────────────────────────────────────────────────
--
-- The other thing clubs leave behind every July. Bylaws, minutes, budgets and
-- the grant application somebody spent a weekend on all live in one outgoing
-- secretary's email, and the new board starts from nothing.
--
-- Three things make this more than a file list:
--
--   **Visibility is per document.** Public documents can appear on the club's
--   own website through the site builder; members' documents need a session;
--   board documents need the capability. One library, three audiences.
--
--   **Versions supersede rather than overwrite.** Uploading the 2027 bylaws
--   keeps the 2026 ones, linked, because "what did it say before we amended
--   it" is a question that gets asked at exactly the wrong moment.
--
--   **A year tag.** The unit of Rotary memory is the Rotary year, and being
--   able to ask for everything from 2024-25 is worth more than a folder tree.
CREATE TABLE document_folders (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id     TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  parent_id   TEXT REFERENCES document_folders(id) ON DELETE CASCADE,
  -- The most restrictive visibility any document in it may have. A folder
  -- marked 'board' cannot contain a public document, which is the check that
  -- stops the minutes ending up on the website.
  visibility  TEXT NOT NULL DEFAULT 'members',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (tenant_id, club_id, slug)
);
CREATE INDEX idx_folders_club ON document_folders(tenant_id, club_id, sort_order);

CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id      TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  folder_id    TEXT REFERENCES document_folders(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  r2_key       TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL DEFAULT 0,
  -- 'public' | 'members' | 'board'.
  visibility   TEXT NOT NULL DEFAULT 'members',
  -- "2024-25". Rotary years run July to June and every club thinks in them.
  year_tag     TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  -- The document this one replaces. Chains backwards, so the history of an
  -- amended set of bylaws is a walk rather than a guess.
  supersedes_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  -- Set when a newer version supersedes this one. Superseded documents stay
  -- readable and stop appearing in the default list.
  superseded_at TEXT,
  download_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_documents_club ON documents(tenant_id, club_id, created_at);
CREATE INDEX idx_documents_folder ON documents(tenant_id, folder_id, superseded_at);
