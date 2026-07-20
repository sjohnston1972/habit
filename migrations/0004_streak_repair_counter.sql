-- The never-miss-twice repair (CLAUDE.md §2.4) is a safety net, not an
-- unlimited free pass: once spent it regenerates only after 7 consecutive
-- completed days. That requires counting those days, which the run 1 `streaks`
-- table has nowhere to record.
ALTER TABLE streaks ADD COLUMN consecutive_since_repair INTEGER NOT NULL DEFAULT 0;
