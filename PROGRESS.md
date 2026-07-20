# Run 2 Progress — The Daily Loop

**Goal:** A signed-in user can be interviewed, get three scored daily
suggestions, adopt habits, check them off online or offline, and hold a streak
that survives one missed day. That is CLAUDE.md §14's Phase 1 definition of
done, minus polish.

**Plan:** PLAN.md (17 steps, 5 phases)
**Design spec:** `docs/superpowers/specs/2026-07-20-run-2-daily-loop-design.md`

Steps 1–13 need no API key. Steps 14–17 do; step 14 is the preflight that ends
the run cleanly if the key is unusable.

---

## Log

_(Append one timestamped entry per completed step. Never edit history.)_

### 2026-07-20 — Step 1: Profile schema, weights config, default profile — DONE

Added `src/shared/profile.ts`: `ProfileSchema` (Zod) matching CLAUDE.md §5's
JSON shape. `category_scores` is built programmatically from `CATEGORIES`
(from `src/shared/habit.ts`) and `.strict()`'d, so it structurally can
never have more or fewer than the 12 real category keys, and is keyed by
the full category label (e.g. `"Exercise & Movement"`) to match
`Habit.category` exactly — not the abbreviated keys (`"exercise"`,
`"housework"`) in CLAUDE.md §5's illustrative example. `preferred_times`
is restricted to `morning | midday | evening` (matching step 2's bucket
domain, no `anytime`).

Added `src/shared/weights.ts`: `WEIGHTS` with the six values from the plan
(`categoryFit: 3.0, timeMatch: 2.0, capacityFit: 1.5, balanceBonus: 1.0,
novelty: 1.0, progression: 0.5, declinedPenalty: 2.0`), alone in its own
file per the plan's rationale (tuning shouldn't touch scoring logic).

Added `src/shared/default-profile.ts`: `DEFAULT_PROFILE` — all 12
categories at 50, `capacity_minutes_per_day: 15`, `preferred_times:
["morning", "evening"]`, empty `identity_goals`/`avoid_tags`, empty
`notes`.

Added `test/default-profile.test.ts` (3 tests): `DEFAULT_PROFILE` parses
against `ProfileSchema`; has exactly 12 category keys; every key appears
as a `category` value somewhere in `ALL_HABITS`.

Verified:
- `npm test` → 9 test files, 29 passed (3 new + all 26 prior tests still
  green).
- `npm run build` → exits 0.

Committed as `b5843c4` and pushed to `origin/main` successfully.

Next step: Step 2 (Time-of-day bucketing — `src/shared/time-of-day.ts`
exporting `bucketFor` and `localDateFor`, both timezone-aware via
`Intl.DateTimeFormat`).

### 2026-07-20 — Step 2: Time-of-day bucketing — DONE

Added `src/shared/time-of-day.ts`:

- `bucketFor(date, timezone): "morning" | "midday" | "evening"` — 05–10
  morning, 11–16 midday, 17–21 and 22–04 evening. Reads the local hour via
  `Intl.DateTimeFormat("en-GB", { hour12: false })`, never the server clock.
  Guards the ICU `"24"`-for-midnight rendering with `% 24`.
- `localDateFor(date, timezone): string` — `YYYY-MM-DD` via the `en-CA`
  locale, which formats zero-padded in exactly that shape.
- Exports a `Bucket` type for steps 3–4 to consume.

Written test-first. The test failed for the right reason (module absent),
and writing the assertions first caught a genuine error in my own arithmetic
before any implementation existed: I had asserted 18:00Z was morning in
`America/Los_Angeles` when it is 11:00 local, i.e. midday. Corrected in the
test, then implemented.

Added `test/time-of-day.test.ts` (31 tests): every hour 00–23 against `UTC`,
plus `Pacific/Auckland` (UTC+12) and `America/Los_Angeles` (UTC-7) covering
both directions of date rollover, a same-instant-different-bucket case across
three zones, and zero-padding of single-digit months and days.

Verified:
- `npm run build` → exits 0.
- `npm test` → 10 test files, 60 passed (31 new + all 29 prior still green).

Next step: Step 3 (the scoring function — `src/shared/scoring.ts`, one test
per term with the others held constant, plus a determinism test).

### 2026-07-20 — Step 3: The scoring function — DONE

Added `src/shared/scoring.ts`: `scoreHabit(habit, profile, ctx)` returning
`{ score, breakdown }`. Pure — no clock, no D1, no mutation of its inputs.
Term formulas, each normalised to 0..1 before weighting:

| Term | Formula |
|---|---|
| `categoryFit` | `category_scores[habit.category] / 100` |
| `timeMatch` | 1 if `time_of_day` is the current bucket or `anytime`, else 0 |
| `capacityFit` | 1 up to capacity, linear to 0 at 2x capacity, clamped |
| `balanceBonus` | `1 / (1 + activeInCategory)` |
| `novelty` | 0 if suggested in last 14 days, else 1 |
| `progression` | `1 - |difficulty - ideal| / 2`, ideal = 1 / 2 / 3 at streak <7 / 7-29 / 30+ |
| `declinedPenalty` | 1 if previously dismissed, else 0 |

Two decisions the plan left open, both recorded here because they are the
kind of thing that is invisible later:

1. **`ScorableHabit = Habit & { id: string }`.** The plan's signature takes
   `Habit`, but `Habit` (the Zod seed shape) carries no `id`, and the
   novelty/declined terms need one. `ScorableHabit` is the D1 row shape —
   seed fields plus primary key — and still satisfies the plan's signature.
2. **`breakdown` holds *weighted* contributions, not raw 0..1 terms**, so
   the parts sum exactly to the whole and a `suggestion_log` row explains
   its own score without needing the weights that produced it. The tradeoff
   is noted below as a run-3 finding.

Written test-first; the test failed for the right reason (module absent).
Added `test/scoring.test.ts` (28 tests): one describe block per term
isolating it against a neutral fixture, plus the sum-equals-total invariant,
a determinism test asserting deep equality across repeated calls, and a
no-mutation test.

Verified:
- `npm run build` → exits 0.
- `npm test` → 11 test files, 88 passed (28 new + all 60 prior still green).

**Findings for run 3 (not blockers, no action taken this run):**

- `scripts/seed.ts:26` assigns habit ids with `crypto.randomUUID()` at seed
  time, so ids are not stable across re-seeds. Step 4 tie-breaks on
  `habit.id` ascending, which stays deterministic *within* a seeding but
  will reshuffle equal-scoring habits after any re-seed — and existing
  `suggestion_log` / `user_habits` rows would point at ids the new library
  no longer has. A deterministic id (slug or content hash) is the fix.
- `Profile.avoid_tags` is collected by the schema but no scoring term
  consumes it. Neither the plan nor the design spec lists it as a term or a
  filter, so I have not invented one. It needs a decision from Steven:
  hard filter, or a penalty term with a weight.

Next step: Step 4 (suggestion selection and `GET /api/suggestions` —
`src/worker/suggestions.ts`, top 3 with `suggestion_log` writes).

### 2026-07-20 — Step 4: Suggestion selection and the endpoint — DONE

Added `src/worker/suggestions.ts`: `getSuggestions(db, userId, now)` loads the
user's timezone and profile (falling back to `DEFAULT_PROFILE` when the row is
absent *or* malformed), builds `ScoringContext` from D1, hard-filters adopted
habits before scoring, scores all remaining candidates, sorts by score
descending with `habit.id` ascending as tie-break, takes 3, and writes one
`suggestion_log` row per suggestion with `score_breakdown` JSON via `db.batch`.
Wired `GET /api/suggestions` behind `requireAuth` in `src/worker/index.ts`.

All five context queries are scoped by the session-resolved `user_id`.
`shown_at` is written in SQLite's `datetime()` text format so the 14-day
novelty window compares lexicographically.

Written test-first. Added `test/suggestions.test.ts` (17 tests): the five
assertions the plan requires, plus profile fallback (absent and malformed),
archived habits becoming suggestable again, the declined penalty and both
sides of the 14-day novelty boundary, and timezone-derived bucketing.

One test failed on first run — the stored-profile fixture supplied only 6 of
the 12 categories, `ProfileSchema.strict()` rejected it, and the engine
correctly fell back to defaults. The fixture was wrong, not the code; step 1's
structural strictness is what caught it. Fixed the fixture.

**Deviation from the plan's done-condition, stated plainly:** the plan asks
that "repeated calls with the same fixture return the same habit ids in the
same order". I implemented that as *two users in identical states get
identical suggestions*, which is what determinism actually means here. The
same user called twice does **not** return the same three, because the first
call logs those habits to `suggestion_log` and the novelty term then scores
them at zero. That is the specified novelty behaviour working as designed —
but see the finding below, because it has a product consequence the plan
did not anticipate.

Verified:
- `npm run build` → exits 0.
- `npm test` → 12 test files, 105 passed (17 new + all 88 prior still green).

**Findings for Steven (no action taken — these need a decision):**

- **Suggestions are not stable within a day.** `GET /api/suggestions` rescores
  and re-logs on every call, so each app open shows a different three and
  writes 3 more `suggestion_log` rows. Ten opens in a day = 30 rows and ten
  different card sets. Step 10 calls this endpoint on mount, so the Today
  screen will visibly reshuffle. Two consequences: the user never gets a
  stable "today's three" to commit to, and the Phase 3 tuning data is
  inflated by impressions that were never really separate suggestions. The
  fix is to return the already-logged set when one exists for the user's
  local date, and only score when there isn't — but that is a branch neither
  PLAN.md nor the design spec describes, so I have not invented it.
- Carried forward from step 3, unchanged: random habit ids at seed time, and
  `avoid_tags` being collected but unused.

Next step: Step 5 (streaks migration `0003_streak_repair_counter.sql` and
`src/shared/streaks.ts` — `applyCheckin` as a pure function).

### 2026-07-20 — Step 4a: Day-stable suggestions — DONE

Not in PLAN.md. Added at Steven's explicit instruction in the interactive
session, in response to the finding logged under step 4: suggestions
reshuffled on every app open and logged a fresh impression each time.

Added `migrations/0003_suggestion_log_local_date.sql`: a nullable
`local_date TEXT` column on `suggestion_log` plus an index on
`(user_id, local_date)`. `shown_at` is UTC and so cannot answer "was this
shown on the user's today"; this mirrors how `checkins.local_date` already
works. Nullable because pre-existing rows have no local date to backfill.

`getSuggestions` now computes the user's local date, and if any
`suggestion_log` rows exist for it, replays them — original order, stored
score and breakdown, no new rows written — instead of rescoring. Scoring
happens once per local day.

Two sub-behaviours the instruction didn't specify, decided and recorded:

1. **Rows with an outcome are filtered out of the replay.** A habit adopted
   or dismissed today has been dealt with and shouldn't return as a card.
   The survivors keep their original order, so acting on one card never
   moves the others.
2. **An emptied set is not refilled until the next local day.** If the user
   acts on all three, they see no suggestions until tomorrow rather than a
   fresh three. Refilling would reintroduce exactly the churn this step
   removes, and the 5-habit cap means endless same-day adoption is not a
   goal worth serving.

**Knock-on for step 5:** this took migration number `0003`. The streak
repair counter PLAN.md step 5 describes as `0003_streak_repair_counter.sql`
must therefore be created as `0004_streak_repair_counter.sql`. Nothing else
about step 5 changes.

Written test-first: 5 new tests failed for the right reason before the
migration and replay path existed. Added to `test/suggestions.test.ts`
(22 tests total): same three in the same order when called again the same
day; no second impression logged on replay; a fresh set once the local day
rolls over; the day keyed on the user's timezone rather than UTC (two calls
straddling Auckland's local midnight); and an acted-on suggestion dropping
out without reshuffling the rest. Extended `test/schema.test.ts` to assert
the `local_date` column exists.

The plan's original done-condition wording — "repeated calls with the same
fixture return the same habit ids in the same order" — now holds literally
for the same user, not just for two users in identical states.

Verified:
- `npm run build` → exits 0.
- `npm test` → 12 test files, 111 passed (6 new + all 105 prior still green).

Next step: Step 5, with the migration renumbered to `0004` as noted above.

### 2026-07-20 — Step 5: Streaks migration and the streak rule — DONE

Added `migrations/0004_streak_repair_counter.sql` (renumbered from the plan's
`0003`, which step 4a took): `consecutive_since_repair INTEGER NOT NULL
DEFAULT 0` on `streaks`.

Added `src/shared/streaks.ts`: `applyCheckin(streak, localDate)` returning
`{ streak, outcome }`, pure and non-mutating. Every row of the design spec's
rule table is implemented: same day → `noop`; yesterday → increment; 2 days
ago with repair → increment as `repaired`, repair consumed; 2 days ago without
→ reset to 1; 3+ days → reset to 1; never completed → 1. `best` rises with
`current` and survives a reset. A reset hands the repair back and zeroes the
counter; the counter only advances while the repair is spent, and regenerates
it at exactly 7.

**One case the plan did not specify, decided and flagged:** a check-in dated
*before* `last_completed_date` returns `noop`. Step 12's offline queue can
flush Tuesday's check-off on Wednesday, after Wednesday's has been recorded —
without this guard a late arrival would compute a negative gap and reset a
healthy streak. Covered by an explicit test.

Added `test/streaks.test.ts` (16 tests): one per rule-table row, best-streak
behaviour including survival through a reset, regeneration at exactly 7 (with
the day-6 case asserting it has *not* regenerated yet), counter starting at
zero on the repair day, out-of-order replay, non-mutation, and the schema
column assertion the plan asked to add to `test/schema.test.ts` (placed here
alongside the rest of the streak coverage instead).

Verified:
- `npm run build` → exits 0.
- `npm test` → 13 test files, 127 passed (16 new + all 111 prior still green).

Next step: Step 6 (adoption endpoint — `src/worker/tracking.ts`,
`POST /api/habits/:id/adopt`).
