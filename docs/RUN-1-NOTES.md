# Run 1 Notes — Foundation, Auth, and Habit Library

Written at the end of Run 1 (2026-07-20) as the handoff to Run 2. See
`docs/runs/2026-07-20-foundation-auth-habit-library/` for the full PLAN.md
and PROGRESS.md this run worked from.

## What exists

**Project skeleton**
- Cloudflare Worker (Hono) at `src/worker/index.ts`, D1 binding `DB` →
  database `habit-db` (`wrangler.toml`).
- Vite + React + Tailwind app at `src/app`, served as static assets.
  Installable PWA via `vite-plugin-pwa` (manifest, service worker, two
  emoji-backed SVG icons).
- Shared code (usable from both Worker and app) lives in `src/shared`.
- Three parallel `tsc --noEmit` passes in `npm run build`
  (`tsconfig.json` for the app/DOM, `tsconfig.worker.json` for the
  Workers-typed code, `tsconfig.scripts.json` for the Node-typed CLI
  scripts) — kept separate because the DOM/Workers/Node global type sets
  conflict.
- Tests run under `@cloudflare/vitest-pool-workers` (`npm test`), against
  a real (Miniflare-emulated) D1 instance with migrations applied fresh
  per test file via `test/apply-migrations.ts`.

**Database** (`migrations/0001_init.sql`, `0002_magic_links_ip.sql`)
- All 12 tables from CLAUDE.md §12 exist: `users`, `sessions`,
  `magic_links` (+ `ip` column added in 0002), `habits`, `profiles`,
  `user_habits`, `stacks`, `checkins`, `streaks`, `qa_sessions`,
  `suggestion_log`, `push_subscriptions`.
- Every user-owned table cascades on `users` deletion (`ON DELETE
  CASCADE`, verified by `test/cascade-delete.test.ts`); `user_habits.stack_id`
  uses `ON DELETE SET NULL` instead, since deleting a stack shouldn't delete
  its habits.
- D1/Miniflare enforces foreign keys by default — no `PRAGMA` needed.

**Habit library**
- `seed/*.json` — 364 habits across all 12 CLAUDE.md §4 categories (30-32
  each), validated by `src/shared/habit.ts`'s `HabitSchema` (Zod).
- `npm run validate:library` checks schema validity, duplicate titles
  across all files, and reports total/per-category counts.
- `src/shared/seed-data.ts` statically imports all 12 seed files (no
  filesystem access needed — works inside the Workers runtime) and
  exports `ALL_HABITS` + `LIBRARY_VERSION` (currently `1`).
- `src/worker/seed.ts`'s `seedHabits(db)` deletes and re-inserts the whole
  `habits` table — idempotent by construction, never duplicates.
- `npm run seed` — Node CLI that generates the same SQL and runs it via
  the local `wrangler` bin, for seeding a real local dev D1 database.

**Auth (magic links + sessions)**
- `src/worker/hash.ts` — shared SHA-256 hex hashing helper.
- `src/worker/session.ts` — `createSession`/`lookupSession`/`renewSession`/
  `deleteSession`. Tokens are two concatenated UUIDs, hashed before
  storage; 30-day rolling expiry (`renewSession` slides the window
  forward, refuses to revive an expired session).
- `src/worker/magic-link.ts` — `requestMagicLink`/`redeemMagicLink`.
  15-minute single-use tokens, hashed before storage. Rate limited to 3
  requests per rolling minute per email-or-IP (the 4th is rejected).
  `EmailSender` interface with a `ConsoleEmailSender` dev implementation
  (logs instead of sending — no real provider wired up this run).
- `src/worker/auth-middleware.ts` — `requireAuth` resolves the session
  cookie to `c.get("userId")`; 401 if missing/invalid/expired. This is the
  multi-tenancy rule in code: routes read the caller's identity only from
  the verified session, never from request input.

## Endpoints

| Route | Method | Auth | What it does |
|---|---|---|---|
| `/health` | GET | none | `{ ok: true }` liveness check |
| `/api/auth/request-link` | POST | none | Body `{ email }`. Issues a magic link (console-logged in dev), 400 on invalid email, 429 if rate-limited |
| `/api/auth/callback` | GET | none (token-based) | Query `?token=`. Redeems the magic link, creates-or-fetches the user, sets the `habit_session` cookie (HttpOnly/Secure/SameSite=Lax/30-day), 400 on invalid/used/expired token |
| `/api/me` | GET | session cookie (`requireAuth`) | Returns the caller's own `users` row; 401 if unauthenticated |

## Frontend

- `src/app/screens/SignIn.tsx` — email form → `POST /api/auth/request-link`;
  on load, reads `?token=` from the URL and calls `GET /api/auth/callback`,
  showing signed-in/error state. This is the whole UI right now — no
  onboarding, no dashboard, no habit list yet.
- `src/app/components/Mascot.tsx` — `<Mascot mood="idle|happy|celebrating|sad" />`,
  🦦 emoji-backed, `motion-safe:` animations (respects
  `prefers-reduced-motion`, also enforced globally in `src/app/index.css`).
- Rounded typefaces (Baloo 2 for display, Nunito for body) are genuinely
  self-hosted via `@fontsource/baloo-2`/`@fontsource/nunito`.
- 12 category accent colours are Tailwind tokens (`tailwind.config.js`
  `theme.extend.colors.category.*`) but nothing in the UI consumes them
  yet — no habit cards or category-colored surfaces exist.

## Verification (Step 13 sweep, 2026-07-20)

`npm run build && npm test && npm run validate:library` — all three exited
0 in one invocation:
- **build**: 3 tsc passes clean, Vite build + PWA plugin emit
  `manifest.webmanifest`/`sw.js`/`workbox-*.js` alongside the JS/CSS bundle.
- **test**: 8 test files, 26 tests, all passed.
- **validate:library**: 364 habits, every one of the 12 categories at
  30-32, zero duplicate titles, "Library valid."

## What Run 2 should pick up

Per CLAUDE.md §14, Phase 1 MVP still needs (none of this exists yet):
1. **Onboarding AI interview** (§5) — the Claude API call, tappable-first
   Q&A, the profile JSON schema + validation + fallback-to-defaults logic,
   `qa_sessions` logging with token usage. Needs a Claude API key as a
   Worker secret — out of scope for a "no secrets" local run; Run 2 should
   plan how dev/test can proceed without a live key (e.g. a fake/mock
   Claude client behind an interface, mirroring the `EmailSender` pattern
   used for magic links this run).
2. **Daily rule-based suggestion engine** (§6) — the scoring formula,
   weights config file, `suggestion_log` writes. No AI, pure D1 reads —
   this can be built and fully tested locally with no blockers.
3. **Habit adoption, check-off, and streaks** (§7) — `user_habits`,
   `checkins`, `streaks` are all migrated and cascade-tested, but nothing
   writes to them yet outside of test fixtures. The never-miss-twice
   streak-repair rule (§2/§7) isn't implemented.
4. **Real habit list / dashboard UI** — right now the frontend is only the
   sign-in screen. The category accent colours exist as Tailwind tokens
   but are unused.
5. **GDPR self-service** (§13) — export-my-data and delete-my-account
   endpoints don't exist yet. The cascade-delete behavior they'd rely on
   is already verified (`test/cascade-delete.test.ts`), so this should be
   straightforward once scoped.
6. Still open from CLAUDE.md §15: final product name, `app.` vs root
   subdomain, MailChannels vs Resend (Resend is the working assumption
   behind the `EmailSender` interface but nothing is wired to a real
   provider), pricing/paid-tier intent, and the mascot's final identity
   (otter is locked in for this run, per PLAN.md).

No blockers were hit this run — all 13 PLAN.md steps completed.
