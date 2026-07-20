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

### 2026-07-20 — Steps 6 & 7: Adoption, check-off and undo — DONE

Committed together rather than one commit per step: both live in
`src/worker/tracking.ts`, and step 7's route work exposed a type error in
step 6's route that had to be fixed in the same edit. Both were verified
green before committing.

**Step 6 — adoption.** `adoptHabit(db, userId, habitId)` inserts the
`user_habits` row at level `tiny`, creates the `streaks` row zeroed but with
`repair_available = 1`, and marks the most recent `suggestion_log` row for
that habit as `adopted` — all three in one `db.batch`. Rejects an unknown
habit with 404 and the 6th active habit with 409 `habit_cap_reached`,
counting only rows where `archived_at IS NULL`. Wired
`POST /api/habits/:id/adopt` behind `requireAuth`, returning 201.

Not in the plan, added deliberately: **adopting the same habit twice returns
409 `already_adopted`.** `user_habits` has no unique constraint on
(user_id, habit_id), so without this guard a double tap would give the user
the same habit twice with two independent streaks. Flagged rather than
silently assumed — a DB-level constraint would be the sturdier fix and is
worth considering in run 3.

**Step 7 — check-off and undo.** `checkIn` resolves the user_habit and proves
ownership in one query, computes the local date in the user's timezone,
`INSERT OR IGNORE`s the check-in, and applies `applyCheckin` only when a row
was actually inserted — so re-posting the same local date returns 200 with
outcome `noop` and leaves the streak untouched, exactly as steps 12–13 need.
The route accepts an optional `local_date` in the body so the offline queue
can replay a check-off made on an earlier day; ownership is still proven
server-side and the date is regex-validated.

`undoCheckIn` deletes the local date's check-in and then **recomputes the
streak by replaying the entire check-in history** through `applyCheckin`,
rather than trying to invert the last increment. Inversion is not possible in
general — the removed check-in may have consumed a repair, reset a streak, or
raised `best`. Replay is exact precisely because `applyCheckin` is pure, which
is the payoff for step 5's design.

A type error surfaced during this step: `c.req.param("id")` is
`string | undefined` under this tsconfig. Guarded with an explicit 404 in all
three routes rather than casting the type away.

Added `test/adopt.test.ts` (10 tests) and `test/checkin.test.ts` (14 tests),
both test-first and both red for the right reason first. Between them they
cover every assertion the plan lists, plus: archiving freeing a cap slot,
per-user cap isolation, double-adopt, reset reporting, timezone-derived local
dates, undo restoring a consumed repair, undo of the only check-in returning
to zero, undo with nothing to undo, and 404s for both unknown and
someone-else's user_habit ids.

Verified:
- `npm run build` → exits 0.
- `npm test` → 15 test files, 151 passed (24 new + all 127 prior still green).

Next step: Step 8 (`GET /api/today`).

### 2026-07-20 — Step 8: The today endpoint — DONE

Added `getToday(db, userId, now)` to `src/worker/tracking.ts` and wired
`GET /api/today` behind `requireAuth`. One query joins `user_habits` to
`habits`, `streaks` and `checkins`, with the check-in join keyed on the
user's local date so `completed` flips at *their* midnight. Archived habits
are excluded; ordering is `adopted_at` then `id`, so the list is stable.

The row carries everything a habit card needs to render without a second
request — title, category, both versions, identity statement, cue, level,
completion, and current/best streak plus `repair_available`. Step 9's card
consumes this shape directly.

Added `test/today.test.ts` (11 tests), test-first: completion true and false,
yesterday's check-in *not* counting as today's, adopted level carried
through, streak values carried through, card copy present, archived excluded,
cross-tenant isolation, empty list for a new user, 401 unauthenticated, and
completion computed in the user's timezone rather than UTC.

Verified:
- `npm run build` → exits 0.
- `npm test` → 16 test files, 162 passed (11 new + all 151 prior still green).

Phase B complete. Next step: Step 9 (habit card component and category
colours) — the first frontend step.

### 2026-07-20 — Step 9: Habit card, category colours, and a second test environment — DONE

**Infrastructure the plan implied but did not name.** Steps 10–13 require
tests that render React and drive IndexedDB. Neither exists in workerd, which
is where every test has run until now. Added `vitest.workspace.ts` with two
projects: the existing `vitest.config.ts` (workerd, via vitest-pool-workers)
for Worker and shared code, and a new `app` project (jsdom, `@vitejs/plugin-react`)
for frontend code. The split is by directory — `test/app/**` is the browser
side, everything else the Worker side — with `test/app/**` excluded from the
worker project and from `tsconfig.worker.json`, plus a new
`tsconfig.app-test.json` in the build chain so app tests are type-checked with
`jsx` available. Testing Worker code against the real runtime was worth
keeping; this preserves that while giving the frontend a DOM.

New dev dependencies: `@testing-library/react`, `@testing-library/user-event`,
`jsdom`, `fake-indexeddb` (step 12), and `canvas-confetti` + its types
(step 11 — the only animation library CLAUDE.md §10 permits).

Added `src/app/category-colors.ts`: all 12 categories mapped to their
`category.*` Tailwind token names, plus `categoryToken()` which falls back to
a usable token rather than throwing on an unknown category.

Added `src/app/components/HabitCard.tsx`: chunky rounded card, 4px accent
border in the category colour, sticker shadow, `min-h-[5.5rem]` tap target,
title, level-appropriate version, identity statement, and streak. Rendered as
a `<button>` with `aria-pressed`, so check-off state reaches assistive tech.
Accepts a `pending` flag for step 13's unsynced indicator.

Accent classes are stored as **complete class strings** rather than built by
interpolation: Tailwind scans source text, so `bg-category-${token}` would
compile to nothing. This is the run-1 palette's first real consumer.

Added `test/app/category-colors.test.ts` (6 tests) and
`test/app/habit-card.test.tsx` (10 tests), both test-first. Beyond the plan's
asks, the colour tests assert every category maps to a distinct token and that
no palette token is left orphaned; the card tests assert `aria-pressed`
tracks completion and that **every** animation-related class is behind
`motion-safe:` — a structural guard rather than a one-off check.

Two build failures found and fixed along the way: the worker project was
collecting `test/app/**`, and `tsc` was checking JSX under the worker config.
Both are config fixes, not test edits.

Verified:
- `npm run build` → exits 0 (now four tsc passes).
- `npm test` → 18 test files, 178 passed (16 new + all 162 prior still green).

Next step: Step 10 (the Today screen).

### 2026-07-20 — Step 10: The Today screen — DONE

Added `src/app/screens/Today.tsx`: mascot, streak summary ("Best streak going:
N days · X of Y done today"), active habit cards from `GET /api/today`, and
suggestions from `GET /api/suggestions` dealt out as cards with Adopt and
"Not today" actions. Check-off and adopt update optimistically so a tap feels
instant. `src/app/App.tsx` now resolves the session via `/api/me` and routes
to `Today` when signed in, `SignIn` otherwise — deliberately deferring to
`SignIn` while a magic-link token is still in the URL so the two don't race
to redeem it.

Added `src/app/components/SuggestionCard.tsx` (category accent bar, tiny-first
copy, adopt/dismiss) and a `fadeInUp` keyframe in `index.css` with a staggered
`animation-delay` so the three cards deal rather than appear at once. All of it
behind `motion-safe:`; run 1's global reduced-motion rule covers the rest.

**Endpoint the plan implied but never specified:** the dismiss action had
nowhere to go. Added `POST /api/habits/:id/dismiss`, which marks the open
`suggestion_log` row `dismissed` — the exact outcome the scoring engine's
`declinedPenalty` already reads, so dismissing now genuinely stops a habit
being re-offered. Covered by 3 tests in `test/adopt.test.ts` including
cross-tenant isolation.

**A real bug caught by writing the test first.** The check-off handler read
`nowCompleted` out of a `setHabits` updater and used it to choose POST vs
DELETE. React 18 need not have run that updater yet, so the method was
computed from stale state — the UI looked right while the request was wrong.
The screen now decides from the state it can already see and passes that into
the updater. This is exactly the class of bug that tests-after would have
missed, because the visible behaviour was correct.

Added `test/app/today-screen.test.tsx` (10 tests) against a mocked fetch:
active habits render, exactly three suggestions render, both together, streak
summary, empty-state copy for a new user, adopt calls the right endpoint,
dismiss removes just that card, the all-dealt-with message, check-off issues a
POST to the right user_habit, and a friendly message when fetch throws.

Verified:
- `npm run build` → exits 0.
- `npm test` → 19 test files, 191 passed (13 new + all 178 prior still green).

Next step: Step 11 (check-off feedback — confetti, haptics, repair and reset
copy).

### 2026-07-20 — Step 11: Check-off feedback — DONE

Added `src/app/feedback.ts`: `celebrateCheckoff(outcome)` fires a
canvas-confetti burst sized to the outcome and a Vibration API buzz, guarded
by `"vibrate" in navigator`; `prefersReducedMotion()` reads the media query
and assumes motion is fine when `matchMedia` is missing entirely (some
embedded browsers lack it). `OUTCOME_MESSAGE` holds the copy.

The reduced-motion guard is a **hard stop, not a smaller animation**: if the
user asked their phone for less movement they get no confetti and no buzz at
all. `disableForReducedMotion` is passed to confetti as well, so the library's
own guard backs up ours.

A repair gets 140 particles to an ordinary day's 60 — saving a streak is the
better story. `Phew — saved it! Your streak lives on.` on `repaired`,
`Fresh start! Day one of the next streak.` on `reset`. No red, no warning
iconography, per CLAUDE.md §10's tone rule.

The Today screen now reads the check-in response and **replaces its optimistic
streak guess with the server's number**. The optimistic +1 is right for an
ordinary day but wrong for a repair or reset, and the server is the authority.
`canvas-confetti` recorded in `package.json` dependencies.

Added `test/app/checkoff-feedback.test.tsx` (13 tests): the plan's required
assertion (no confetti *and* no vibration under `prefers-reduced-motion:
reduce`) plus vibration absent on devices without the API, no celebration on
`noop`, a repair bursting bigger than an ordinary day, `matchMedia` missing
entirely, and screen-level tests that the repair and fresh-start copy appear
with no red styling.

Verified:
- `npm run build` → exits 0.
- `npm test` → 20 test files, 204 passed (13 new + all 191 prior still green).

Phase C complete. Next step: Step 12 (the offline queue).

### 2026-07-20 — Steps 12 & 13: Offline check-off queueing — DONE

**Step 12 — the queue.** Added `src/app/offline-queue.ts`: `enqueue`, `flush`,
`pending`, plus `dequeue` and `clearQueue`, backed by IndexedDB. Items are
keyed `user_habit_id:local_date` and written with `put`, so re-queueing the
same habit and day overwrites rather than duplicating — one row per habit per
day, the same shape the server's unique constraint enforces.

`flush` drops an item on 2xx *and* on 4xx. A 4xx means the item can never
succeed (habit deleted, not yours); retrying it forever would wedge the queue
behind it. Network failures and 5xx leave the item queued.

Added `test/app/offline-queue.test.ts` (12 tests): enqueue/flush/clear, item
retained on network failure and on 5xx, dropped on 404, the same local date
sent on every replay, persistence across a simulated reload, dedupe by
habit+day, separate rows for separate days, and a later item still flushing
when an earlier one fails.

**Step 13 — wiring it in.** The Today screen's check-off now enqueues *before*
attempting the network, then flushes. If the tab dies between tap and request,
the check-off is already on disk rather than lost. `flush` runs on mount (for
anything left from a previous visit) and on the `online` event. Habits with an
unflushed check-in show the `pending` indicator step 9 built into the card.

`flush` was extended to return each item's server response, so a repair
celebration still fires when a check-off made hours ago finally syncs — the
queue would otherwise have swallowed the outcome. Undo dequeues the item if it
never left, so undoing an offline check-off leaves nothing behind to sync.

The client sends the local date from the *device's* timezone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`), because a check-off
should be dated where the user actually was when they tapped.

**Four pre-existing tests failed on first run**, all with the same cause:
jsdom ships no IndexedDB, so the queue write threw before any request went
out. Fixed in `test/app/setup.ts` by loading `fake-indexeddb/auto` for every
app test and deleting the database after each one, rather than patching the
four tests individually.

Added `test/app/offline-checkin.test.tsx` (7 tests): completed shown
immediately with no connection, the item queued, the waiting-to-sync marker
appearing and clearing, flush on the `online` event, flush on mount of a
leftover item carrying its original date, and undo removing a queued item.

Added `test/offline-replay.test.ts` (5 worker-side tests) for the plan's
required integration case: the same queued check-in replayed three times
yields exactly one `checkins` row and one increment, with `noop` on the
repeats. Also covers a check-off counting for the day it was made rather than
the day it synced, a late out-of-order arrival leaving a healthy streak
untouched (step 5's guard, proven through the HTTP layer), cross-tenant
refusal, and a malformed date rejected with 400 rather than stored.

Verified:
- `npm run build` → exits 0.
- `npm test` → 23 test files, 228 passed (24 new + all 204 prior still green).

Phase D complete. Steps 1–13 are done: the entire key-independent daily loop
is committed and pushed. Next step: Step 14, the API key preflight.

### 2026-07-20 — Step 14: API key preflight — PASSED

One minimal live call to `claude-haiku-4-5` (`max_tokens: 16`, message "ping")
via the official `@anthropic-ai/sdk` (installed this step, `^0.112.4`).

Result: **HTTP 200.** Model `claude-haiku-4-5-20251001`, `stop_reason:
max_tokens` (expected — the 16-token cap cut the reply short, which is the
point of a cheap probe). Token usage: **8 input, 16 output**, no cache
activity. Cost of the probe is a rounding error against Haiku's $1/$5 per MTok.

No `Blockers` entry needed. Steps 15–17 are cleared to proceed.

Note for step 15: `claude-haiku-4-5` accepts neither `effort` nor the newer
adaptive-thinking config — thinking is left off entirely, as the plan
specifies.

Next step: Step 15 (the Claude client — `src/worker/claude.ts`).
