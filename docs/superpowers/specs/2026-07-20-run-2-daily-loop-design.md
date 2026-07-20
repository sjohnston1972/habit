# Run 2 Design — The Daily Loop

**Date:** 2026-07-20
**Status:** Approved, ready for PLAN.md
**Predecessor:** Run 1 (foundation, auth, habit library) — see `docs/RUN-1-NOTES.md`

## Goal

By the end of run 2, a signed-in user can be interviewed, receive three scored
daily suggestions, adopt habits, check them off (online or offline), and hold a
streak that survives one missed day. That is CLAUDE.md §14's Phase 1 definition
of done, minus polish.

## Scope decisions (settled with Steven, 2026-07-20)

| Decision | Choice | Consequence |
|---|---|---|
| Run size | All five subsystems in one run | ~15 grouped steps; riskiest last |
| Claude API key | Live key, no mock; tests hit the real API | Every `npm test` from the AI phase onward needs network + a valid key |
| Build order | engine → tracking → UI → AI → offline | Everything key-independent is committed before anything touches the API |
| Offline check-off | In scope | IndexedDB queue, replay-safe by unique constraint |
| Active habit cap | 5 (CLAUDE.md §15 #4) | User-adjustable later; not in run 2 |
| Mascot | Otter, carried from run 1 | Not revisited this run |

### Why riskiest-last

The suggestion engine, tracking, and UI need no secrets and no network. The AI
interview needs both. Ordering the key-dependent subsystem last means a bad or
rate-limited key at 3am costs only the AI phase — steps 1–11 are already
committed and pushed. A preflight key check runs as the **first step of the AI
phase**, not of the run, so it fails into a `Blockers` note with the daily loop
already working.

### Cost containment under the live-API choice

Since tests hit the real API, AI-touching tests are deliberately few, use
`claude-haiku-4-5` ($1/$5 per MTok), and set tight `max_tokens`. A full
`npm test` should cost a fraction of a penny. `qa_sessions` logs tokens per
session so real usage stays observable (CLAUDE.md §5).

---

## 1. Suggestion engine (CLAUDE.md §6)

Deterministic, explainable, zero AI cost. Same inputs always produce the same
three suggestions in the same order.

### Files

- `src/shared/weights.ts` — the six weights and the declined penalty, alone in
  one file so tuning never touches logic.
- `src/shared/scoring.ts` — `scoreHabit(habit, profile, context) → { score, breakdown }`.
  A pure function over plain data: no D1, no clock, no I/O. Fully unit-testable.
- `src/shared/default-profile.ts` — the profile used before onboarding exists.
- `src/worker/suggestions.ts` — loads candidates from D1, scores, takes top 3,
  writes `suggestion_log`.

### Scoring

```
score = w1·category_fit    3.0
      + w2·time_match      2.0
      + w3·capacity_fit    1.5
      + w4·balance_bonus   1.0
      + w5·novelty         1.0
      + w6·progression     0.5
      − declined_penalty   2.0
```

Each term normalises to 0..1 before weighting:

- **category_fit** — `profile.category_scores[habit.category] / 100`.
- **time_match** — 1.0 if the habit's `time_of_day` matches the user's current
  bucket or is `anytime`; 0.0 otherwise.
- **capacity_fit** — 1.0 if `duration_minutes <= capacity_minutes_per_day`,
  falling off linearly to 0.0 at twice capacity.
- **balance_bonus** — higher for categories with fewer of the user's active
  habits, so the engine spreads across life areas.
- **novelty** — 0.0 if the habit appears in `suggestion_log` within 14 days,
  1.0 otherwise.
- **progression** — rewards difficulty appropriate to the user's streak
  maturity (tiny habits early, harder ones once streaks are established).
- **declined_penalty** — applied when `suggestion_log` records a `dismissed`
  outcome for this habit.

**`adopted_exclusion` is a hard filter, not a score term.** Already-active
habits are removed from the candidate set before scoring.

**Tie-breaking** is by `habit.id` ascending, so equal scores never produce a
nondeterministic order.

### Time-of-day buckets

Computed in the user's stored IANA timezone (CLAUDE.md §7), never the server's:

| Bucket | Local hours |
|---|---|
| `morning` | 05:00–10:59 |
| `midday` | 11:00–16:59 |
| `evening` | 17:00–21:59 |
| `evening` (late) | 22:00–04:59 |

Late night maps to `evening` rather than a fifth bucket — the library has no
`night` habits, and wind-down habits are the right suggestion at 23:00.

### The profile dependency

The engine ships before the AI interview, so it reads a default profile:

```ts
{
  category_scores: { /* all 12 categories at 50 */ },
  capacity_minutes_per_day: 15,
  preferred_times: ["morning", "evening"],
  identity_goals: [],
  avoid_tags: [],
  notes: ""
}
```

When onboarding lands in phase 4, real profiles replace this with **no engine
changes** — the engine reads whatever profile it is handed.

### Endpoint

`GET /api/suggestions` (session required) → today's three, each with its score
breakdown. Every suggestion shown is logged to `suggestion_log` with
`score_breakdown` JSON — the tuning data for Phase 3.

### Verification

Unit tests over `scoreHabit` covering each term in isolation, a determinism
test (same inputs → identical output across repeated calls), an exclusion test
(adopted habits never suggested), and a multi-tenancy test (user A's
suggestions never read user B's `suggestion_log`).

---

## 2. Adoption, check-off, streaks (CLAUDE.md §7)

### Files

- `src/shared/streaks.ts` — `applyCheckin(streak, localDate) → newStreak`, pure.
- `src/worker/tracking.ts` — endpoints and D1 writes.

### The never-miss-twice rule

`applyCheckin` is a pure function so every branch is testable without a
database:

| Last completed | `repair_available` | Result |
|---|---|---|
| Today | — | No-op (idempotent) |
| Yesterday | — | `current + 1` |
| 2 days ago | `true` | `current + 1`, repair consumed → `false` |
| 2 days ago | `false` | Reset to 1 |
| 3+ days ago | — | Reset to 1 |
| Never | — | `current = 1` |

`best` updates whenever `current` exceeds it. **Repair regenerates after 7
consecutive completed days**, making it a genuine safety net rather than an
unlimited free pass. A reset always regenerates the repair — a fresh start
starts fresh.

Consuming a repair is a distinct, surfaceable outcome so the UI can show
CLAUDE.md §10's "phew — saved it!" moment rather than a silent increment.

### Endpoints

| Route | Method | Does |
|---|---|---|
| `/api/habits/:id/adopt` | POST | Adopts at `tiny` level (§2: new adopters always start tiny). Rejects past the 5-habit cap. Logs the `adopted` outcome to `suggestion_log`. |
| `/api/user-habits/:id/checkin` | POST | Records a check-in for the caller's local date, applies the streak rule. |
| `/api/user-habits/:id/checkin` | DELETE | Same-day undo. |
| `/api/today` | GET | The caller's active habits with today's completion state and current streaks. |

`checkins` already carries a unique constraint on `(user_habit_id, local_date)`
from run 1. That constraint is what makes check-in **idempotent**, which is what
makes offline replay safe in §5.

### Verification

Exhaustive unit tests over every row of the rule table above, including repair
regeneration and reset behaviour. Integration tests for the cap, same-day undo,
and the multi-tenancy rule.

---

## 3. Dashboard UI (CLAUDE.md §10)

A Today screen replacing the sign-in-only frontend:

- Mascot reacting to state (idle / happy / celebrating / sad).
- Streak summary across active habits.
- Active habit cards, one-tap check-off, category accent colour per card.
- Today's three suggestions, dealt out like cards, each adoptable or
  dismissable.

This is where run 1's 12 unused `category.*` Tailwind tokens finally get
consumed.

**Motion:** squash-and-stretch on press, animated tick, canvas-confetti burst,
Vibration API buzz where supported. `prefers-reduced-motion` is already enforced
globally from run 1, so every effect has a calm fallback for free.

**Tone:** a broken streak reads "Fresh start!", never a red warning. A consumed
repair is celebrated, not scolded.

### Verification

`npm run build` clean across all three tsc passes; component tests for
check-off state transitions and the reduced-motion fallback path.

---

## 4. AI onboarding interview (CLAUDE.md §5)

**This phase runs last and is the only one that needs the API key.**

### Files

- `src/worker/claude.ts` — the API client. Worker-side only; the key is a
  Worker secret and never reaches the browser.
- `src/shared/profile.ts` — Zod `ProfileSchema`, shared by Worker and app.
- `src/worker/onboarding.ts` — turn handling, `qa_sessions` logging, rate limit.

### Model and call shape

`claude-haiku-4-5` — CLAUDE.md §5's "Haiku-class", $1/$5 per MTok, 200K context.

The profile is returned via **structured outputs** (`output_config.format` with
a JSON schema), so the shape is enforced API-side rather than parsed and hoped
for. Zod re-validates on receipt regardless. §5's "retry once, then fall back to
defaults" remains as a genuine last resort rather than a routine path — and the
fallback is exactly the `default-profile.ts` the engine already runs on, so a
failed interview degrades to a working app rather than a broken one.

Note `claude-haiku-4-5` does not support the `effort` parameter; thinking is not
needed for this task and is left off.

### Interview design

Tappable-first with free text where it matters (CLAUDE.md §15 #3) — faster on
mobile, fewer tokens. 8–12 questions covering typical weekday shape, most
neglected life area, available minutes, preferred times, and identity goals.

### Guardrails

- Rate limit: 3 AI sessions per user per day, reusing run 1's rate-limiting
  pattern from `magic-link.ts`.
- `qa_sessions` records transcript, `tokens_used`, and type per session so cost
  stays observable.
- The interview requires connectivity and says so clearly (§9).

### Endpoint

`POST /api/onboarding/turn` (session required).

### Preflight

The **first step of this phase** verifies the key with one minimal live call.
If it fails, the step writes a `Blockers` entry to PROGRESS.md and the run ends
cleanly with the daily loop already shipped.

### Verification

Live-API tests, deliberately few, with tight `max_tokens`. Profile validation
and fallback-to-defaults are tested offline against fixtures — only the calls
that genuinely exercise the API contract hit the network.

---

## 5. Offline check-off queueing (CLAUDE.md §9)

### Files

- `src/app/offline-queue.ts` — IndexedDB queue and flush logic.

### Design

A check-off made offline writes optimistically to local UI state and appends to
an IndexedDB queue. The queue flushes on the `online` event and on app open.

**Replay is idempotent by construction.** The unique constraint on
`(user_habit_id, local_date)` means a replayed check-in either inserts once or
conflicts harmlessly — last-write-wins falls out of the schema rather than
needing conflict-resolution logic. A queued check-in carries the local date it
was made on, so a check-off made offline on Tuesday still counts for Tuesday
when it syncs on Wednesday.

The AI interview requires connectivity and is clearly marked as such. Everything
else in the daily loop works offline.

### Verification

Unit tests over queue enqueue/flush/dedupe. An integration test replaying the
same queued check-in twice and asserting one `checkins` row and one streak
increment.

---

## Step ordering and plan shape

CLAUDE.md asks for 5–15 steps. Five subsystems honestly lands at **17 grouped
steps** — compressing further would mean steps too large to finish in one turn,
which is worse than exceeding the guideline. Each step keeps a runnable
done-condition and its own commit, so resumability is unchanged.

| Steps | Phase | Needs key |
|---|---|---|
| 1–4 | Suggestion engine | No |
| 5–8 | Adoption, check-off, streaks | No |
| 9–11 | Dashboard UI | No |
| 12–13 | Offline check-off queueing | No |
| 14–16 | AI interview (14 = key preflight) | **Yes** |
| 17 | Full verification sweep | Yes (AI tests are live) |

**Offline queueing sits before the AI phase, not after.** It depends on the
check-off endpoints from steps 5–8 but not on the API key, and the riskiest-last
principle says every key-independent subsystem ships before anything that can be
blocked by a bad key. If the preflight fails at step 14, the entire offline-capable
daily loop is already committed and pushed, and only the AI work defers to run 3.

Step 17's sweep does need the key, since AI tests are live. If the run ends at a
blocker in step 14, the last passing sweep is whatever step 13 left green — the
plan's per-step verification is what guarantees that state is sound, not the final
sweep.

## Out of scope for run 2

Web Push and Cron reminders (Phase 2), stats dashboard and heatmap (Phase 2),
habit stacking UI (Phase 2), fortnightly check-ins (Phase 2), tiny→standard
graduation (Phase 2), GDPR export/delete endpoints, passkeys, and a real email
provider — `ConsoleEmailSender` remains the dev path.

## Still unresolved (CLAUDE.md §15)

Final product name, root vs `app.` subdomain, Resend vs MailChannels, and
pricing intent. None block run 2.
