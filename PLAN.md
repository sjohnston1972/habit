# Run 2 Plan — The Daily Loop

**Design spec:** `docs/superpowers/specs/2026-07-20-run-2-daily-loop-design.md` (read it first)
**Predecessor:** `docs/RUN-1-NOTES.md`

**Goal:** A signed-in user can be interviewed, get three scored suggestions,
adopt habits, check them off online or offline, and hold a streak that survives
one missed day.

## How to work this plan

- Re-read PLAN.md and PROGRESS.md first thing every turn. State on disk is truth.
- One step per turn. Commit, `git push`, then append a timestamped entry to
  PROGRESS.md. If push fails, note it in PROGRESS.md and carry on.
- Run the step's done-condition command before marking it complete. Never mark
  a step done on the strength of having written the code.
- Steps 1–13 need no API key. Steps 14–17 do — see the preflight in step 14.
- If something is ambiguous, stop: write it under a `Blockers` heading in
  PROGRESS.md and end the run. Do not guess.

## Global constraints

- Every user-owned query filters on the session's `user_id` (CLAUDE.md §12).
  Identity comes only from `requireAuth`'s `c.get("userId")`, never from request input.
- All timestamps stored UTC; "today" and streak boundaries computed in the
  user's stored IANA timezone (CLAUDE.md §7).
- Shared pure logic goes in `src/shared/` so it is testable without D1 or a clock.
- Tone: warm, never guilt. Broken streak reads "Fresh start!" (CLAUDE.md §10).
- `prefers-reduced-motion` fallback for every animation (already global in `src/app/index.css`).
- Model for all AI calls: `claude-haiku-4-5`. Worker-side only.

---

## Phase A — Suggestion engine (no API key)

### Step 1: Profile schema, weights config, default profile

Create `src/shared/profile.ts` with a Zod `ProfileSchema` matching CLAUDE.md §5's
JSON shape (`category_scores`, `capacity_minutes_per_day`, `preferred_times`,
`identity_goals`, `avoid_tags`, `notes`) and `export type Profile = z.infer<typeof ProfileSchema>`.
Follow the pattern in `src/shared/habit.ts`.

> The profile type lands in step 1, not with the AI work in phase E, because
> steps 3 and 4 consume it. Phase E only adds the code that *populates* it.

Create `src/shared/weights.ts` exporting `WEIGHTS` with `categoryFit: 3.0`,
`timeMatch: 2.0`, `capacityFit: 1.5`, `balanceBonus: 1.0`, `novelty: 1.0`,
`progression: 0.5`, `declinedPenalty: 2.0`.

Create `src/shared/default-profile.ts` exporting `DEFAULT_PROFILE: Profile`: all
12 category scores at 50, `capacity_minutes_per_day: 15`, `preferred_times:
["morning","evening"]`, empty `identity_goals`/`avoid_tags`, empty `notes`.
Category keys must match the `category` values used in `seed/*.json` exactly.

**Done when:** `test/default-profile.test.ts` asserts `DEFAULT_PROFILE` parses
against `ProfileSchema`, has exactly 12 category keys, and that every key appears
as a `category` in `ALL_HABITS`. `npm run build && npm test` exits 0.

### Step 2: Time-of-day bucketing

Create `src/shared/time-of-day.ts` exporting
`bucketFor(date: Date, timezone: string): "morning" | "midday" | "evening"`.
Local hours 05–10 → morning, 11–16 → midday, 17–21 → evening, 22–04 → evening.
Use `Intl.DateTimeFormat` with the IANA zone; do not use the server's local time.

Also export `localDateFor(date: Date, timezone: string): string` returning
`YYYY-MM-DD` in that zone — steps 5–8 and 12–13 depend on it.

**Done when:** `test/time-of-day.test.ts` covers each boundary hour and at least
two timezones on opposite sides of UTC (e.g. `Pacific/Auckland`, `America/Los_Angeles`),
including a case where the local date differs from the UTC date. `npm test` exits 0.

### Step 3: The scoring function

Create `src/shared/scoring.ts`:

```ts
export interface ScoreBreakdown {
  categoryFit: number; timeMatch: number; capacityFit: number;
  balanceBonus: number; novelty: number; progression: number;
  declinedPenalty: number;
}
export interface ScoringContext {
  bucket: "morning" | "midday" | "evening";
  activeCountByCategory: Record<string, number>;
  recentlySuggestedHabitIds: ReadonlySet<string>;  // last 14 days
  declinedHabitIds: ReadonlySet<string>;
  maxCurrentStreak: number;
}
export function scoreHabit(
  habit: Habit, profile: Profile, ctx: ScoringContext
): { score: number; breakdown: ScoreBreakdown }
```

Each term normalises to 0..1 before weighting, per the spec's §1 table.
`capacityFit` is 1.0 at or under capacity, falling linearly to 0.0 at twice
capacity, clamped at 0. `scoreHabit` must not read the clock or touch D1.

**Done when:** `test/scoring.test.ts` has one test per term isolating it (hold
others constant), plus a determinism test calling `scoreHabit` twice on identical
inputs and asserting deep equality. `npm test` exits 0.

### Step 4: Suggestion selection and the endpoint

Create `src/worker/suggestions.ts` exporting
`getSuggestions(db, userId, now): Promise<Suggestion[]>`. It loads the user's
profile (falling back to `DEFAULT_PROFILE` when `profiles` has no row), builds
`ScoringContext` from D1, **excludes already-adopted habits before scoring**,
scores all candidates, sorts by score descending with `habit.id` ascending as
tie-break, takes 3, and writes one `suggestion_log` row per suggestion with
`score_breakdown` JSON.

Wire `GET /api/suggestions` in `src/worker/index.ts` behind `requireAuth`.

**Done when:** `test/suggestions.test.ts` asserts: exactly 3 returned; an adopted
habit never appears; repeated calls with the same fixture return the same habit
ids in the same order; 3 `suggestion_log` rows are written with non-null
`score_breakdown`; and user A's call reads none of user B's rows. `npm test` exits 0.

---

## Phase B — Adoption, check-off, streaks (no API key)

### Step 5: Streaks migration and the streak rule as a pure function

The `streaks` table from run 1 has no column for tracking repair regeneration.
First create `migrations/0003_streak_repair_counter.sql`:

```sql
ALTER TABLE streaks ADD COLUMN consecutive_since_repair INTEGER NOT NULL DEFAULT 0;
```

Then create `src/shared/streaks.ts`:

```ts
export interface StreakState {
  current: number; best: number;
  last_completed_date: string | null;  // YYYY-MM-DD
  repair_available: boolean;
  consecutive_since_repair: number;
}
export type CheckinOutcome = "incremented" | "repaired" | "reset" | "noop";
export function applyCheckin(
  streak: StreakState, localDate: string
): { streak: StreakState; outcome: CheckinOutcome }
```

Rules (spec §2 table): same day → `noop`; yesterday → increment; 2 days ago with
`repair_available` → increment, outcome `repaired`, repair consumed; 2 days ago
without → reset to 1; 3+ days → reset to 1; never completed → `current = 1`.
`best` updates when `current` exceeds it. A reset restores `repair_available: true`
and zeroes `consecutive_since_repair`. Repair regenerates once
`consecutive_since_repair` reaches 7.

**Done when:** `test/streaks.test.ts` has a case for every row of that table plus
repair regeneration at exactly 7 days and a `best` update, and
`test/schema.test.ts` is extended to assert the `consecutive_since_repair` column
exists. `npm test` exits 0.

### Step 6: Adoption endpoint

Create `src/worker/tracking.ts`. Add `POST /api/habits/:id/adopt` behind
`requireAuth`: inserts a `user_habits` row at level `tiny`, creates the matching
`streaks` row zeroed **but with `repair_available = 1`** (the never-miss-twice
safety net is a promise from day one, not a reward to be earned), rejects with
409 past the 5-habit cap (count only rows
where `archived_at IS NULL`), rejects with 404 for an unknown habit id, and
updates the habit's most recent `suggestion_log` row for this user to outcome
`adopted`.

**Done when:** `test/adopt.test.ts` asserts a successful adopt creates both rows
at level `tiny`; the 6th adopt returns 409; an unknown id returns 404; and user A
cannot adopt into user B's account. `npm test` exits 0.

### Step 7: Check-off and undo

Add to `src/worker/tracking.ts`: `POST /api/user-habits/:id/checkin` and
`DELETE /api/user-habits/:id/checkin`. POST computes the local date from the
user's timezone via `localDateFor`, inserts into `checkins`, applies
`applyCheckin`, persists the new streak, and returns the `CheckinOutcome` so the
UI can show the repair celebration. **Re-posting the same local date must be a
no-op returning 200, not an error** — steps 12–13 depend on that.

DELETE removes today's check-in and reverses the streak change.

**Done when:** `test/checkin.test.ts` asserts: a check-in increments the streak;
posting twice for the same local date yields one `checkins` row and one
increment; DELETE restores the prior state; a check-in two days after the last
one with repair available returns outcome `repaired`; and user A cannot check off
user B's habit. `npm test` exits 0.

### Step 8: The today endpoint

Add `GET /api/today` behind `requireAuth`, returning the caller's active habits
with their level, today's completion state (computed in the user's timezone),
and current/best streak.

**Done when:** `test/today.test.ts` asserts an adopted-and-checked-off habit
comes back `completed: true`, an adopted-but-not-checked-off habit comes back
`completed: false`, archived habits are excluded, and user A sees none of user B's
habits. `npm test` exits 0.

---

## Phase C — Dashboard UI (no API key)

### Step 9: Habit card and category colours

Create `src/app/components/HabitCard.tsx` — a card taking a habit, its streak,
and a completion state, styled with the matching `category.*` Tailwind token from
`tailwind.config.js`. Chunky rounded shape, fat corner radius, soft shadow,
large tap target (CLAUDE.md §10).

Create `src/app/category-colors.ts` mapping each of the 12 category values from
`seed/*.json` to its Tailwind token name.

**Done when:** `npm run build` exits 0, and `test/category-colors.test.ts`
asserts every category present in `ALL_HABITS` has a mapping and every mapping
names a token that exists in `tailwind.config.js`. `npm test` exits 0.

### Step 10: The Today screen

Create `src/app/screens/Today.tsx`: mascot, streak summary, active habit cards
from `GET /api/today`, and the three suggestions from `GET /api/suggestions`
dealt out as cards with adopt and dismiss actions. Route to it from
`src/app/App.tsx` when a session exists; keep `SignIn` for the signed-out case.

**Done when:** `npm run build` exits 0 and `test/today-screen.test.ts` renders the
screen against a mocked fetch and asserts active habits and exactly three
suggestions appear. `npm test` exits 0.

### Step 11: Check-off feedback

Add to the check-off interaction: squash-and-stretch press, animated tick,
`canvas-confetti` burst, and a Vibration API buzz guarded by a
`"vibrate" in navigator` check. Add the repair celebration ("phew — saved it!")
when the check-in response outcome is `repaired`, and "Fresh start!" copy on
`reset` — never a red warning. All motion under `motion-safe:`.

`canvas-confetti` is the only animation library permitted (CLAUDE.md §10).

**Done when:** `npm install canvas-confetti` recorded in `package.json`,
`npm run build` exits 0, and `test/checkoff-feedback.test.ts` asserts confetti is
not fired and no vibration is attempted when `prefers-reduced-motion: reduce`
matches. `npm test` exits 0.

---

## Phase D — Offline check-off queueing (no API key)

### Step 12: The queue

Create `src/app/offline-queue.ts` exporting `enqueue(checkin)`, `flush(fetchFn)`,
and `pending()`, backed by IndexedDB. A queued item carries the `user_habit_id`
and the **local date it was made on**, so a Tuesday check-off syncs as Tuesday
even if it flushes on Wednesday. `flush` drops an item once the server returns
2xx; on network failure the item stays queued.

**Done when:** `test/offline-queue.test.ts` (fake-indexeddb) asserts enqueue then
flush clears the queue, a failing fetch leaves the item queued, and flushing the
same item twice sends the same local date both times. `npm test` exits 0.

### Step 13: Wire the queue into check-off

Change the Today screen's check-off to write optimistically to local state and
enqueue, then flush. Call `flush` on the `online` event and on app mount.
Show a subtle pending indicator on habits with an unflushed check-in.

**Done when:** `test/offline-checkin.test.ts` asserts an offline check-off shows
completed immediately and flushes on reconnect, and an integration test replays
the same queued check-in twice asserting exactly one `checkins` row and one
streak increment. `npm run build && npm test` exits 0.

---

## Phase E — AI onboarding interview (NEEDS THE API KEY)

### Step 14: Key preflight — STOP HERE IF IT FAILS

Before writing any AI code, verify the key works with one minimal live call
(`claude-haiku-4-5`, `max_tokens: 16`, message "ping").

**If the call fails for any reason** — missing key, auth error, rate limit —
write a `Blockers` entry in PROGRESS.md naming the exact error, commit, push, and
**end the run** per CLAUDE.md's "Ending a run". Do not attempt steps 15–17. The
daily loop from steps 1–13 is already shipped and is a complete run.

**Done when:** either the live call returns a 200 and PROGRESS.md records the
token usage, or PROGRESS.md contains a `Blockers` entry and the run is ended.

### Step 15: The Claude client

`ProfileSchema` already exists from step 1. Create `src/worker/claude.ts` with a
client calling `claude-haiku-4-5` via `output_config.format` structured outputs,
using `ProfileSchema`'s JSON-schema form so the shape is enforced API-side.
Validate the response with `ProfileSchema` regardless; on failure retry once,
then fall back to `DEFAULT_PROFILE`.

Note `claude-haiku-4-5` does not accept the `effort` parameter — do not send it.
Thinking is not needed here; leave it off.

**Done when:** `test/profile-schema.test.ts` (offline, fixtures only) asserts a
valid profile parses, a malformed one is rejected, and the fallback returns
`DEFAULT_PROFILE`. One live test asserts a real call returns a
`ProfileSchema`-valid object. `npm test` exits 0.

### Step 16: The onboarding endpoint

Create `src/worker/onboarding.ts` with `POST /api/onboarding/turn` behind
`requireAuth`: 8–12 tappable-first questions with free text where it matters,
writes the final profile to `profiles`, logs transcript and `tokens_used` to
`qa_sessions`, and rate-limits to 3 sessions per user per day reusing the pattern
in `src/worker/magic-link.ts`.

**Done when:** `test/onboarding.test.ts` asserts a completed interview writes one
`profiles` row and one `qa_sessions` row with non-zero `tokens_used`, the 4th
session in a day returns 429, and user A cannot read user B's `qa_sessions`.
`npm test` exits 0.

### Step 17: Full verification sweep and run notes

Run `npm run build && npm test && npm run validate:library` in one invocation.
Confirm the suggestion engine now reads the real profile written by onboarding
(no engine code should need to change — if it does, that is a finding worth
writing down).

Write `docs/RUN-2-NOTES.md` in the shape of `docs/RUN-1-NOTES.md`: what exists,
the endpoint table, and a punch list for run 3.

**Done when:** all three commands exit 0 in one invocation, `docs/RUN-2-NOTES.md`
exists and is committed, and PROGRESS.md records the test count.
