-- 0007_platform_fee.sql — make our own cut a column, not a footnote.
--
-- Event tickets are the first and only thing Sodalitas takes a fee on. Dues
-- and donations pass through untouched, and that stays true.
--
-- `event_registrations.platform_fee_cents` already records the fee per
-- booking, which answers "what did you take from this person". It does not
-- answer the question a treasurer actually asks, which is "reconcile this
-- Stripe payout" — and that question is asked of `payments` and
-- `checkout_sessions`, where until now our fee was invisible.
--
-- So both tables gain the same column, defaulting to zero. Every existing row
-- is a dues payment or a donation, and zero is the true value for all of them.
--
-- The three numbers, kept distinct because conflating any two of them makes a
-- reconciliation impossible:
--
--   charged_cents      what the card was charged
--   fee_cents          Stripe's processing fee
--   platform_fee_cents ours — capped, and zero unless it's a paid ticket
--
-- The club receives charged_cents minus the other two.

ALTER TABLE checkout_sessions ADD COLUMN platform_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN platform_fee_cents INTEGER NOT NULL DEFAULT 0;
