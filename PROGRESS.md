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
