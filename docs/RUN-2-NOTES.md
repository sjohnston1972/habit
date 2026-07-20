# Run 2 Notes — The Daily Loop

Written at the end of Run 2 (2026-07-20) as the handoff to Run 3. See
`docs/runs/2026-07-20-the-daily-loop/` for the full PLAN.md and PROGRESS.md
this run worked from, and `docs/RUN-1-NOTES.md` for what run 1 left behind.

**Goal, met:** a signed-in user can be interviewed, receive three scored daily
suggestions, adopt habits, check them off online or offline, and hold a streak
that survives one missed day.

## What exists

**Suggestion engine** (`src/shared/scoring.ts`, `src/worker/suggestions.ts`)
- `scoreHabit(habit, profile, ctx)` — pure, no clock, no D1, no mutation.
  Seven terms, each normalised to 0..1 then weighted by `src/shared/weights.ts`.
  The returned `breakdown` holds *weighted* contributions, so the parts sum to
  the whole and a logged row explains its own score.
- `getSuggestions(db, userId, now)` — loads profile (falling back to
  `DEFAULT_PROFILE` when absent *or* malformed), builds context from five
  user-scoped queries, hard-filters adopted habits, scores, takes 3, logs.
- **Suggestions are stable for the user's local day** (step 4a): scored once,
  replayed thereafter from `suggestion_log`. Acting on a card removes it; the
  set is not refilled until the next local day.

**Timezone handling** (`src/shared/time-of-day.ts`)
- `bucketFor` and `localDateFor`, both via `Intl.DateTimeFormat` against the
  user's stored IANA zone. Nothing in the daily loop reads the server clock's
  local time.

**Streaks** (`src/shared/streaks.ts`)
- `applyCheckin(streak, localDate)` — pure, covering every row of the
  never-miss-twice table. Repair is available from adoption, consumed on a
  save, regenerated after 7 consecutive days, and handed back on a reset.
- A check-in dated *before* `last_completed_date` is a `noop`, so a late
  offline flush cannot damage a healthy streak.
- Undo **recomputes from the full check-in history** rather than inverting the
  last change — exact precisely because `applyCheckin` is pure.

**Tracking** (`src/worker/tracking.ts`)
- Adoption at level `tiny` with the 5-habit cap, check-off, same-day undo, and
  the Today read model.

**Dashboard** (`src/app/`)
- `screens/Today.tsx` — mascot, streak summary, habit cards, three dealt
  suggestion cards with adopt / "Not today".
- `components/HabitCard.tsx`, `components/SuggestionCard.tsx`,
  `category-colors.ts` (run 1's 12 palette tokens finally consumed).
- `feedback.ts` — confetti, haptics, and warm outcome copy, with a hard stop
  under `prefers-reduced-motion`.

**Offline** (`src/app/offline-queue.ts`)
- IndexedDB queue keyed `user_habit_id:local_date`. Enqueue happens *before*
  the network attempt; flush runs on mount and on the `online` event. Replay is
  idempotent by the `checkins` unique constraint, not by client bookkeeping.

**AI onboarding** (`src/worker/claude.ts`, `src/worker/onboarding.ts`)
- A fixed 9-question tappable-first script; the model is called **once**, at
  the end, to turn answers into a profile. Structured outputs enforce the shape
  API-side, Zod re-validates, one retry, then `DEFAULT_PROFILE`.
- Model: `claude-haiku-4-5`. Rate limited to 3 sessions per user per day.

## Endpoints

| Route | Method | Auth | Does |
|---|---|---|---|
| `/health` | GET | — | Liveness |
| `/api/auth/request-link` | POST | — | Send a magic link (rate limited) |
| `/api/auth/callback` | GET | — | Redeem a link, set the session cookie |
| `/api/me` | GET | session | The caller's own user row |
| `/api/suggestions` | GET | session | Today's three, stable for the local day |
| `/api/habits/:id/adopt` | POST | session | Adopt at `tiny`; 409 past the cap or on a repeat |
| `/api/habits/:id/dismiss` | POST | session | Mark the open suggestion `dismissed` |
| `/api/user-habits/:id/checkin` | POST | session | Check off (optional `local_date` for replay) |
| `/api/user-habits/:id/checkin` | DELETE | session | Same-day undo |
| `/api/today` | GET | session | Active habits + today's completion + streaks |
| `/api/onboarding/turn` | POST | session | Drive the interview; writes the profile at the end |

## Migrations added this run

- `0003_suggestion_log_local_date.sql` — `local_date` + `(user_id, local_date)` index.
- `0004_streak_repair_counter.sql` — `consecutive_since_repair` on `streaks`.

> Note the renumber: PLAN.md called the streak migration `0003`; step 4a took
> that number first.

## Testing

`npm test` runs a **two-project vitest workspace** (`vitest.workspace.ts`):

- **worker** — workerd via `@cloudflare/vitest-pool-workers`, real D1. Covers
  Worker routes and shared pure logic.
- **app** — jsdom + `@vitejs/plugin-react`, `test/app/**`. Covers components,
  the offline queue (`fake-indexeddb`, loaded globally in `test/app/setup.ts`),
  and the reduced-motion fallbacks.

`npm run build` now runs **four** `tsc --noEmit` passes; `tsconfig.app-test.json`
type-checks the jsdom tests with `jsx` available.

Final sweep: **25 test files, 258 tests, all passing.** `npm run build`,
`npm test`, and `npm run validate:library` each exit 0.

One test hits the live API (`test/profile-schema.test.ts`), skipped
automatically when `ANTHROPIC_API_KEY` is unset.

## Punch list for run 3

Ordered by how much damage each does if left alone.

1. **Habit ids are random per seed — this is a data-loss shape.**
   `scripts/seed.ts` assigns `crypto.randomUUID()` at seed time and re-seeding
   does `DELETE FROM habits`. Any re-seed orphans every `user_habits` and
   `suggestion_log` row pointing at the old ids, and reshuffles the
   equal-score tie-break. A deterministic id (slug or content hash) plus an
   upsert-style seed is the fix. **Do this before any real user data exists.**
2. **`Profile.avoid_tags` is collected and ignored.** The interview asks what
   to avoid; nothing consumes the answer. Needs a decision: hard filter, or a
   penalty term with a weight.
3. **No `user_habits` uniqueness constraint.** Double-adopt is currently
   blocked in application code only (409 `already_adopted`); a DB-level
   `UNIQUE (user_id, habit_id) WHERE archived_at IS NULL` would be sturdier.
4. **The onboarding UI does not exist.** The endpoint is complete and tested,
   but nothing in `src/app` calls it — a new user currently lands on Today with
   the default profile. This is the most visible gap for the Phase 1
   definition of done.
5. **`score_breakdown` stores weighted values.** Good for explaining a single
   row; awkward for Phase 3 re-weighting experiments across weight eras. Decide
   before `suggestion_log` accumulates data worth mining.
6. **No graduation path.** `user_habits.level` is written as `tiny` and never
   changes; the tiny→standard prompt is Phase 2.
7. **Still deferred from run 1:** GDPR export/delete endpoints, a real email
   provider (`ConsoleEmailSender` remains the dev path), Web Push + Cron,
   stats/heatmap, stacking UI.

## Open decisions still unresolved (CLAUDE.md §15)

Final product name, root vs `app.` subdomain, Resend vs MailChannels, and
pricing intent. None blocked run 2; the name and subdomain will start to
matter once anything is deployed publicly.
