# Run 1 Progress — Foundation, Auth, and Habit Library

**Goal:** a locally-runnable Worker + PWA skeleton with working magic-link auth
and the full seeded habit library (350+ habits, 12 categories), all verified by
tests. No AI, no suggestion engine, no deployment.

**Started:** 2026-07-20

---

## Log

_Append one timestamped entry per completed PLAN.md step. Never edit earlier
entries._

### 2026-07-20 — Step 1: Scaffold the project — DONE

Created `package.json` (wrangler + vitest + @cloudflare/vitest-pool-workers +
typescript + vite + react + tailwind + zod + tsx as local devDependencies;
hono/react/react-dom as deps), `tsconfig.json` (app: DOM lib) and
`tsconfig.worker.json` (worker: `@cloudflare/workers-types` lib, kept separate
since the two lib sets conflict), `wrangler.toml` with a `habit-db` D1 binding
(`local-placeholder` id for local dev, `env.production` block stubbed for
later), Hono Worker entry at `src/worker/index.ts` with a `/health` route,
and a Vite + React + Tailwind app shell at `src/app` (with `@shared/branding`
providing the single `PRODUCT` constant per the naming decision). PWA
manifest/service-worker wiring deliberately deferred to step 12 (needs real
icons).

Verified:
- `npm install` — 525 packages, clean.
- `npm run build` → exits 0 (tsc type-check ×2 + vite build, dist output produced).
- `npm exec -- wrangler --version` → prints `3.114.17`, no EBUSY error.

Committed as `ab96bc3` and pushed to `origin/main` successfully.

Next step: Step 2 (Test harness green — wire vitest with
`@cloudflare/vitest-pool-workers`, add a passing test against the `/health`
route).

### 2026-07-20 — Step 2: Test harness green — DONE

Added `vitest.config.ts` using `defineWorkersConfig` pointed at `wrangler.toml`
(runs tests inside Miniflare via `@cloudflare/vitest-pool-workers`, already
installed in step 1). Added `test/health.test.ts` using the `SELF` fetcher
from `cloudflare:test` to hit the Worker's `/health` route and assert
`{ ok: true }`. Extended `tsconfig.worker.json` types to include
`@cloudflare/vitest-pool-workers` (provides `cloudflare:test` module types)
and added `test` to its `include`.

Verified:
- `npm test` → 1 test file, 1 test, all passed.
- `npm run build` → still exits 0 after the tsconfig change.

Committed as `356a031` and pushed to `origin/main` successfully.

Next step: Step 3 (D1 schema migration — `migrations/0001_init.sql` covering
all 12 tables from CLAUDE.md §12, cascading FKs, unique index on
`checkins (user_habit_id, local_date)`).

### 2026-07-20 — Step 3: D1 schema migration — DONE

Wrote `migrations/0001_init.sql` covering all 12 tables from CLAUDE.md §12
(`users` with nullable `plan` and `active_habit_cap` default 5, `sessions`,
`magic_links`, `habits`, `profiles`, `user_habits`, `stacks`, `checkins`,
`streaks`, `qa_sessions`, `suggestion_log`, `push_subscriptions`). All
user-owned FKs use `ON DELETE CASCADE` (habit→user_habits→checkins/streaks
chains cascade transitively); `user_habits.stack_id` uses `ON DELETE SET
NULL` since deleting a stack shouldn't delete the habits in it. Unique index
on `checkins (user_habit_id, local_date)` as required.

Wired the migration into the test harness using the official
`readD1Migrations` (config-side)/`applyD1Migrations` (worker-side) helpers
from `@cloudflare/vitest-pool-workers`, via a `test/apply-migrations.ts`
`setupFiles` entry and a `TEST_MIGRATIONS` miniflare binding in
`vitest.config.ts`. Added `test/env.d.ts` to type the `cloudflare:test` env
(extends the Worker's `Bindings` plus `TEST_MIGRATIONS`).

Verified:
- `npm exec -- wrangler d1 execute habit-db --local --file migrations/0001_init.sql`
  → exit 0, "22 commands executed successfully" (first run against a clean
  local D1; local D1 state lives under gitignored `.wrangler/state`, so a
  fresh clone always starts from zero and this exit-0 run is the true signal
  — re-running the raw SQL a second time correctly fails with "table users
  already exists", since this migration is a one-shot file, not idempotent).
- `npm test` → 2 test files (`health.test.ts`, `schema.test.ts`), 2 passed —
  the schema test queries `sqlite_master` and asserts exactly the 12 expected
  table names exist.
- `npm run build` → still exits 0.

Committed as `f9ba702` and pushed to `origin/main` successfully.

Next step: Step 4 (Cascading-delete test — create a user with rows in every
child table, delete the user, assert every child row is gone).

### 2026-07-20 — Step 4: Cascading-delete test — DONE

Added `test/cascade-delete.test.ts`. It creates one user plus one row in
every user-owned child table (`sessions`, `profiles`, `stacks`,
`user_habits`, `checkins`, `streaks`, `qa_sessions`, `suggestion_log`,
`push_subscriptions` — via a `habit`/`stack`/`user_habit` chain so
`checkins`/`streaks` are reachable through `user_habits.id`), asserts all
those rows exist, deletes the user, then asserts every one of those rows is
gone. It also asserts the `habits` row itself survives, since the library is
not user-owned and must not be swept up by the cascade. `magic_links` is
correctly excluded — it has no `user_id` FK by design (a magic link exists
before an account does; it's keyed by email).

No `PRAGMA foreign_keys` handling was needed — D1/Miniflare enforces FK
constraints (and `ON DELETE CASCADE`/`SET NULL`) by default, confirmed
empirically by this test passing against the real schema with no extra setup.

Verified:
- `npm test` → 3 test files (`health`, `schema`, `cascade-delete`), 3 passed.
- `npm run build` → still exits 0.

Committed as `7dcff47` and pushed to `origin/main` successfully.

Next step: Step 5 (Habit library — schema, validator, and one category:
define the habit record type + Zod validator, write `seed/exercise-movement.json`
with ≥30 habits, `npm run validate:library` script).

### 2026-07-20 — Step 5: Habit library — schema, validator, one category — DONE

Added `src/shared/habit.ts`: the `Habit` type + `HabitSchema` Zod validator
covering every CLAUDE.md §4 field, with `CATEGORIES` (all 12 category
labels) and `TIME_OF_DAY` (`morning | midday | evening | anytime`) as
enums. Enforces non-empty `title`/`identity_statement`/`tiny_version`/
`standard_version`, `difficulty` restricted to `1 | 2 | 3`,
`duration_minutes` a positive integer, and `category`/`time_of_day` in
their allowed sets. `tags`/`stack_anchors` default to `[]`,
`frequency_default` defaults to `"daily"`, `ambitious_version`/
`cue_suggestion`/`prerequisites` are optional (most habits have none, per
spec).

Wrote `seed/exercise-movement.json` with 32 Exercise & Movement habits —
walking, stretching, strength, cardio, balance, and low-impact/seated
variants so the category doesn't assume a single body type or ability
level. Every habit has a genuinely ≤2-minute `tiny_version` (e.g. "Do 1
push-up (knees down is great)", "Circle each ankle 5 times"). No medical
claims.

Added `scripts/validate-library.ts` (`npm run validate:library`): reads all
`seed/*.json`, validates every entry against `HabitSchema`, flags duplicate
titles across files, and prints total + per-category counts. Exit code
reflects only schema/duplicate errors — the ≥30/≥350 count thresholds from
steps 5 and 6 are read off the printed report rather than hard-coded into
the script, since the two steps have different bars against the same tool.

Needed a separate `tsconfig.scripts.json` (Node-typed: `types: ["node"]`)
for `scripts/` — the existing `tsconfig.worker.json` is Workers-typed and
the two global type sets collide. Added `@types/node` as a devDependency
and a third `tsc --noEmit` pass to the `build` script.

Verified:
- `npm run validate:library` → exit 0, reports 32 total habits, all 32 under
  "Exercise & Movement", 0 in the other 11 categories (expected — not yet
  written), "Library valid."
- `npm test` → 3 test files, 3 passed (unaffected by this step).
- `npm run build` → exits 0 (now 3 tsc passes + vite build).

Committed as `b9ee922` and pushed to `origin/main` successfully.

Next step: Step 6 (Habit library — remaining 11 categories, 30-40 habits
each, ≥350 total, zero duplicate titles across all 12 files).

### 2026-07-20 — Step 6: Habit library — remaining 11 categories — DONE

Wrote `seed/*.json` for the remaining 11 CLAUDE.md §4 categories: Nutrition
& Hydration, Sleep & Rest, Mental Health & Mindfulness, Home & Housework,
Money & Admin, Relationships & Social, Work & Focus, Learning & Growth,
Digital Hygiene, Outdoors & Nature, Health & Self-care — 30-32 habits each,
following the same shape as step 5's Exercise & Movement file. Every habit
has a genuinely ≤2-minute `tiny_version`; phrasing stays encouraging and
concrete; no medical claims (a "take your supplement or medication as
directed" habit exists but only as a routine reminder, deferring to
professional direction, not prescribing anything itself); no diet
prescriptions (nutrition habits favour hydration/variety/mindful-eating
framing over restriction); no assumptions about physical ability (Exercise
& Movement includes seated/wall/low-impact variants alongside running and
hiking).

Caught one cross-category title collision during writing — "Read before
bed" existed in both `sleep-rest.json` and `learning-growth.json` (the
latter deliberately matches the CLAUDE.md §4 worked example verbatim).
Renamed the Sleep & Rest entry to "Swap screens for a book at bedtime" to
keep titles globally unique, since `validate:library`'s duplicate check is
across all seed files, not just within one category.

First `validate:library` run came in under the per-category bar (356 total,
but several categories at 28-29, not the required ≥30) — added one extra
habit to Home & Housework, Money & Admin, Work & Focus, Learning & Growth,
Digital Hygiene, and Health & Self-care, and two extra to Outdoors & Nature,
to bring every category to exactly 30+.

Verified:
- `npm run validate:library` → exit 0, 364 total habits, every one of the
  12 categories at 30-32, "Library valid." (zero duplicate titles, zero
  schema errors).
- `npm run build` → still exits 0.
- `npm test` → 3 test files, 3 passed (unaffected by this step).

Committed as `74c6d1a` and pushed to `origin/main` successfully.

Next step: Step 7 (Seed loader — script to load all seed JSON into the
`habits` table with `library_version`, idempotent re-runs, asserted by a
test).

### 2026-07-20 — Step 7: Seed loader — DONE

Added `src/shared/seed-data.ts`: statically imports all 12 `seed/*.json`
files (native ESM JSON imports, resolved at bundle time — no filesystem
access needed, which matters because the Workers runtime has none),
validates every entry through `HabitSchema`, and exports `ALL_HABITS` (364
habits) + `LIBRARY_VERSION` (currently `1`).

Added `src/worker/seed.ts`: `seedHabits(db, habits, libraryVersion)` —
deletes all existing rows in `habits`, then batch-inserts the full habit
list fresh with new UUIDs. Idempotent by construction: every run replaces
the whole table rather than appending, so row count never drifts on
re-runs regardless of how many times it's called.

Added `test/seed.test.ts`: calls `seedHabits(env.DB)` twice against a real
migrated D1 binding and asserts both calls return `ALL_HABITS.length`
inserted and the table's actual row count matches after each call — this is
the direct test of the "running the seed twice leaves the same row count"
requirement. Had to add a `resolve.alias` for `@shared` to `vitest.config.ts`
— it was only configured in the app's `vite.config.ts` before, so
`src/worker/seed.ts`'s `@shared/*` imports didn't resolve under
vitest-pool-workers.

Added `scripts/seed.ts` (`npm run seed`): a Node CLI for manual local
seeding — generates the same DELETE+INSERT SQL from `ALL_HABITS` and runs
it via the local `wrangler` bin (`node <path>/wrangler/bin/wrangler.js d1
execute habit-db --local --file <generated .sql>`), avoiding both `npx`
(EBUSY) and any direct D1 binding access from plain Node (which doesn't
exist outside the Workers runtime).

Verified:
- `npm test` → 4 test files, 4 passed, including `seed.test.ts`.
- `npm run build` → still exits 0.
- `npm run seed` run twice against the local D1 database, then
  `wrangler d1 execute habit-db --local --command "SELECT COUNT(*) FROM habits"`
  → 364 both times, confirming idempotency at the CLI level too, not just
  inside the test.

Committed as `f9097f2` and pushed to `origin/main` successfully.

Next step: Step 8 (Session layer — `sessions` table helpers: create,
look up by hashed token, 30-day rolling expiry, delete; tests for
create/lookup/expiry/renewal).

### 2026-07-20 — Step 8: Session layer — DONE

Added `src/worker/session.ts`: `createSession(db, userId)` generates a raw
token (two concatenated UUIDs), SHA-256-hashes it via Web Crypto
(`crypto.subtle.digest`), and stores only the hash — the raw token is
returned exactly once, to the caller, and never persisted.
`lookupSession(db, token)` hashes the presented token, looks up the row by
`token_hash`, and returns `null` for both unknown and expired sessions
(callers can't distinguish forged from expired, which is intentional).
`renewSession(db, token)` slides the 30-day expiry window forward from now,
refusing to revive a session that's already expired rather than reset its
clock. `deleteSession(db, token)` removes the row (logout).

Added `test/session.test.ts`: 6 tests — create (asserts the stored
`token_hash` is a 64-char hex SHA-256 digest and not equal to the raw
token), lookup (valid token resolves, unknown token returns null), expiry
(a session whose `expires_at` is forced into the past is rejected), renewal
×2 (extends `expires_at` forward and the token stays valid; refuses to
renew an already-expired session), and delete (token stops resolving
afterward). Each test seeds its own `users` row in `beforeEach` since
`sessions.user_id` is a required FK.

Verified:
- `npm test` → 5 test files, 10 passed (6 new session tests + the 4
  existing files, all still green).
- `npm run build` → still exits 0.

Committed as `e8ea585` and pushed to `origin/main` successfully.

Next step: Step 9 (Magic-link issue endpoint — `POST
/api/auth/request-link`: single-use 15-minute token stored hashed, sent via
the `EmailSender` interface with a console-logging dev implementation, rate
limited per-IP and per-email).

### 2026-07-20 — Step 9: Magic-link issue endpoint — DONE

Added `migrations/0002_magic_links_ip.sql`: adds an `ip` column (+ index) to
`magic_links` so the rate limiter can key on IP as well as email — the
original `magic_links` schema from step 3 only had `email`. Picked up
automatically by the test harness's `readD1Migrations` (it scans the whole
`migrations/` directory), no vitest config changes needed.

Extracted `sha256Hex` out of `session.ts` into `src/worker/hash.ts` so both
the session layer and the new magic-link layer share one hashing
implementation.

Added `src/worker/magic-link.ts`: `requestMagicLink(db, email, ip,
emailSender)` generates a raw token, hashes it, and inserts a `magic_links`
row with a 15-minute `expires_at` — only the hash is ever written. Rate
limiting counts rows where `email = ? OR ip = ?` created within the last
minute; a count of 3 or more (i.e. the 4th request) is rejected before any
token is generated. The `EmailSender` interface has a `ConsoleEmailSender`
dev implementation that logs instead of sending, per the run's "do not
attempt live sends" constraint.

Wired `POST /api/auth/request-link` into `src/worker/index.ts`: Zod-validates
the email, reads the requester IP from `CF-Connecting-IP`, returns 400 for a
malformed email, 429 with `{ error: "rate_limited" }` when throttled, 200
otherwise. Moved `zod` from `devDependencies` to `dependencies` in
`package.json` since it's now used at Worker runtime (request validation),
not just for type inference — re-ran `npm install` to sync
`package-lock.json`.

Added `test/magic-link.test.ts` (4 tests): a unit-level test that calls
`requestMagicLink` directly with a capturing `EmailSender`, extracts the raw
token from the "sent" link, and asserts the DB row's `token_hash` equals
`sha256Hex(rawToken)` and is *not* equal to the raw token itself; plus three
HTTP-level tests via `SELF.fetch` — 400 on a malformed email, 200 on a
well-formed request, and 429 on a 4th rapid request from the same IP/email
pair.

Verified:
- `npm test` → 6 test files, 14 passed (4 new + all 10 prior tests still green).
- `npm run build` → still exits 0.
- `npm exec -- wrangler d1 execute habit-db --local --file migrations/0002_magic_links_ip.sql`
  → exit 0, "2 commands executed successfully" against the persistent local
  dev D1 (in addition to the fresh-DB path the automated tests exercise).

Committed as `77964a0` and pushed to `origin/main` successfully.

Next step: Step 10 (Magic-link redeem endpoint — `GET
/api/auth/callback?token=…`: validate, enforce single-use + expiry,
create-or-fetch user, set HttpOnly+Secure+SameSite=Lax session cookie, mark
`used_at`; tests for happy path, reused/expired/forged token).

### 2026-07-20 — Step 10: Magic-link redeem endpoint — DONE

Added `redeemMagicLink(db, token)` to `src/worker/magic-link.ts`: hashes the
presented token, looks it up by `token_hash`, and rejects with a specific
reason — `"invalid"` for an unknown/forged token, `"used"` for one already
redeemed, `"expired"` for one past `expires_at`. On success it marks
`used_at` and calls `findOrCreateUser` (looks up `users` by email, inserts
a new row with `display_name` derived from the email's local part if none
exists), returning the `userId`.

Exported `SESSION_DURATION_MS` and added `SESSION_COOKIE_NAME =
"habit_session"` in `src/worker/session.ts` so the route and the session
layer share one source of truth for the cookie name and lifetime.

Wired `GET /api/auth/callback` in `src/worker/index.ts`: reads the `token`
query param (400 if missing), calls `redeemMagicLink`, returns 400 with
`{ error: reason }` on any failure. On success, calls `createSession` and
sets the session cookie via `hono/cookie`'s `setCookie` with
`httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge:
SESSION_DURATION_MS / 1000`.

Added `test/magic-link-callback.test.ts` (9 tests): happy path (user row
created with the right email, `magic_links.used_at` set); a second
redemption for the same email reuses the existing user rather than creating
a duplicate; reused token rejected (`reason: "used"`); expired token
rejected (`expires_at` forced into the past); forged token rejected
(`reason: "invalid"`); plus HTTP-level checks via `SELF.fetch` — the
`Set-Cookie` header carries `HttpOnly`, `Secure`, and `SameSite=Lax`; a
reused token returns 400; a forged token returns 400; a missing `token`
query param returns 400.

Verified:
- `npm test` → 7 test files, 23 passed (9 new + all 14 prior tests still
  green).
- `npm run build` → still exits 0.

Committed as `46840e6` and pushed to `origin/main` successfully.

Next step: Step 11 (Auth middleware and the multi-tenancy rule — Hono
middleware resolving the session cookie to `user_id`, a protected `GET
/api/me`, and a test asserting cross-tenant isolation plus 401 for
unauthenticated requests).
