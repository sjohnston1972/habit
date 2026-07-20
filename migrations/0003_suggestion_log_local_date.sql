-- Today's three suggestions must be stable for the whole of the user's local
-- day: opening the app again should show the same cards, not reshuffle them and
-- log three more impressions. `shown_at` is UTC and cannot answer "was this
-- shown on the user's today", so the local date is recorded alongside it —
-- the same approach `checkins.local_date` already uses.
--
-- Nullable: rows written before this migration have no local date to backfill.
ALTER TABLE suggestion_log ADD COLUMN local_date TEXT;

CREATE INDEX idx_suggestion_log_user_local_date ON suggestion_log (user_id, local_date);
