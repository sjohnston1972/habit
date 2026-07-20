# Run 1 — Foundation, Auth, and Habit Library

**Goal:** a locally-runnable Worker + PWA skeleton with a working magic-link auth
flow and the full seeded habit library, all verified by tests. No AI, no
suggestion engine, no deployment — those are later runs.

## Decisions already made (do NOT revisit)

- **URL:** `habit.clydeford.net`. Product name stays "Clydeford Habits", but every
  user-visible occurrence comes from a single `PRODUCT` constant in
  `src/shared/branding.ts` so a rename is a one-line change.
- **Email:** Resend, behind an `EmailSender` interface. Dev implementation logs
  the magic link to console. **Do not attempt DNS verification or live sends.**
- **Q&A:** tappable-first. (Not built this run — but the `qa_sessions` transcript
  shape must not assume free-form chat.)
- **Mascot:** an otter, named in code as `mascot`. **Do not attempt to generate
  illustration assets.** Use a single `<Mascot mood="..." />` component backed by
  the 🦦 emoji, with moods `idle | happy | celebrating | sad`. Real art swaps in
  behind that component later.
- **Active habit cap:** default 5, stored per-user and adjustable.
- **Pricing:** free. Schema stays billing-ready (nullable `plan` column on
  `users`) so Phase 3 Stripe needs no migration.

## Hard constraints for this run

- **Everything local.** Use `wrangler d1 execute --local` and vitest against
  miniflare. **Never run `wrangler deploy`, `wrangler login`, or any `--remote`
  command.** They will fail or require interaction.
- **Never invoke wrangler via `npx`** — the npm `_npx` cache is EBUSY-locked on
  this machine. Use the local devDependency: `npm exec -- wrangler ...` after
  step 1, or `./node_modules/.bin/wrangler`.
- No secrets are needed this run. If a step seems to need one, it is out of
  scope — record it in PROGRESS.md under "Blockers" and move on.

---

## Steps

### 1. Scaffold the project
Create `package.json`, TypeScript config, Vite + React + Tailwind, Hono Worker
entry at `src/worker/index.ts`, and `wrangler.toml` with a `habit-db` D1 binding.
Install `wrangler` and `vitest` as **local devDependencies**.

**Done when:** `npm run build` exits 0 and `npm exec -- wrangler --version`
prints a version without an EBUSY error.

### 2. Test harness green
Wire vitest with `@cloudflare/vitest-pool-workers` so tests run against local
miniflare + D1. Add one trivial passing test hitting a Worker `/health` route.

**Done when:** `npm test` exits 0 with at least 1 passing test.

### 3. D1 schema migration
Write `migrations/0001_init.sql` covering every table in CLAUDE.md §12: `users`
(incl. nullable `plan`, `active_habit_cap` default 5, `timezone`), `sessions`,
`magic_links`, `habits`, `profiles`, `user_habits`, `stacks`, `checkins`,
`streaks`, `qa_sessions`, `suggestion_log`, `push_subscriptions`. Foreign keys
with `ON DELETE CASCADE` throughout — GDPR hard-delete (§13) depends on it.
Unique index on `checkins (user_habit_id, local_date)`.

**Done when:** `npm exec -- wrangler d1 execute habit-db --local --file
migrations/0001_init.sql` exits 0, and a test asserts all 12 tables exist.

### 4. Cascading-delete test
Add a test that creates a user with rows in every child table, deletes the user,
and asserts every child row is gone.

**Done when:** `npm test` exits 0 with that test passing.

### 5. Habit library — schema, validator, and one category
Define the habit record type (CLAUDE.md §4) and a Zod validator enforcing:
non-empty `tiny_version`/`standard_version`/`identity_statement`, `time_of_day`
in the allowed set, `difficulty` 1–3, `duration_minutes` > 0. Then write the
first category, **Exercise & Movement**, as `seed/exercise-movement.json`.

**Done when:** `npm run validate:library` exits 0 and reports ≥30 habits.

### 6. Habit library — remaining 11 categories
Write the other 11 categories from CLAUDE.md §4, 30–40 habits each. Content
rules: no medical claims, no diet prescriptions, no assumptions about physical
ability, encouraging and concrete phrasing. Every habit needs a genuinely tiny
(≤2 min) tiny_version.

**Done when:** `npm run validate:library` exits 0, reports ≥350 habits total and
≥30 in each of the 12 categories, with zero duplicate titles.

### 7. Seed loader
Script that loads all seed JSON into the `habits` table with `library_version`,
idempotently (re-running replaces the version cleanly, never duplicates).

**Done when:** running the seed twice leaves the same row count, asserted by a
test.

### 8. Session layer
`sessions` table helpers: create session, look up by token hash, 30-day rolling
expiry, delete. Tokens hashed at rest (SHA-256), never stored raw.

**Done when:** `npm test` passes tests covering create / lookup / expiry / renewal.

### 9. Magic-link issue endpoint
`POST /api/auth/request-link`: accepts an email, creates a single-use token with
15-minute expiry stored **hashed**, sends via the `EmailSender` interface. Dev
sender logs to console. Rate limited per-IP and per-email.

**Done when:** tests pass asserting a hashed token row is written, the raw token
never appears in the DB, and the rate limiter rejects the 4th rapid request.

### 10. Magic-link redeem endpoint
`GET /api/auth/callback?token=…`: validates, enforces single-use and expiry,
creates or fetches the user, sets an HttpOnly + Secure + SameSite=Lax session
cookie, marks the link `used_at`.

**Done when:** tests pass for happy path, reused token rejected, expired token
rejected, and forged token rejected.

### 11. Auth middleware and the multi-tenancy rule
Hono middleware resolving the session cookie to a `user_id` on the request
context, plus a protected `GET /api/me`. Add a test asserting an unauthenticated
request gets 401 and that user A cannot read user B's rows.

**Done when:** `npm test` exits 0 including the cross-tenant isolation test.

### 12. Minimal UI shell
Installable PWA shell via vite-plugin-pwa: manifest, service worker, theme
colour, the 12 category accent colours as Tailwind tokens, the rounded display
typeface self-hosted, the `<Mascot />` component, and a sign-in screen that
drives steps 9–10. Respect `prefers-reduced-motion` from the start.

**Done when:** `npm run build` exits 0 and a test asserts the built output
contains a valid `manifest.webmanifest` with `display: standalone` and at least
192px and 512px icons.

### 13. Full verification sweep
Run the whole suite clean, and write `docs/RUN-1-NOTES.md` recording what exists,
what each endpoint does, and what run 2 should pick up.

**Done when:** `npm run build && npm test && npm run validate:library` all exit 0
in a single invocation, with output pasted into PROGRESS.md.
