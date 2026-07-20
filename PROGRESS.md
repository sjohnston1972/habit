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
