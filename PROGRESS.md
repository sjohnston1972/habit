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
