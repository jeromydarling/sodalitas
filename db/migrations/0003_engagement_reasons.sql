-- 0003_engagement_reasons.sql
--
-- member_engagement already carried the drivers behind a score, and already had
-- last_touch_on from 0002 - what it lacked was the scorer's own plain-language
-- reasons in a form the weekly signal job can read without re-parsing the
-- drivers JSON on every member of every club.
--
-- Without them the signal generator had to guess why someone was at risk, and
-- its guess was always "they have stopped coming". That produced "hasn't been
-- to a meeting in 4 days" for a member who attends every week but sits on no
-- committee, has never been spoken to, and is quietly behind on dues. Right
-- verdict, wrong sentence, and the wrong advice attached to it.
--
-- Newline-separated rather than JSON: it is read far more often than written,
-- and a split beats a parse.

ALTER TABLE member_engagement ADD COLUMN reasons TEXT NOT NULL DEFAULT '';
