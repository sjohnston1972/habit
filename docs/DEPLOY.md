# Deployment

First deployed 2026-07-21 (interactive session). Cloudflare account
`stevie.johnston@gmail.com` (`5bdc4d78…`), authenticated via a
`CLOUDFLARE_API_TOKEN` the harness injects into wrangler.

## Live URLs

| URL | What |
|---|---|
| `https://app.clydeford.net` | Production. Custom domain, the canonical entrance. |
| `https://clydeford-habits.stevie-johnston.workers.dev` | Same Worker script, workers.dev URL. Useful for debugging; serves the **same production data**. Disable with `workers_dev = false` if a single canonical URL is wanted. |

Both are the **same** Worker (`clydeford-habits`) bound to the **same** D1
database — `[env.production]` deliberately reuses the name and DB of the default
env; the split exists so a future staging env can point at its own D1.

## Resources

- **D1 database:** `habit-db`, id `d4273a52-23dc-4b5a-b593-7e8c1278abad`, region WEUR.
- **Static assets:** the built `dist/` (`[assets]` in `wrangler.toml`). Files
  are served directly; non-file paths (`/api/*`, `/health`) fall through to the
  Hono Worker.
- **Secret:** `ANTHROPIC_API_KEY` is set on the Worker (via `wrangler secret
  put`). It lives only in Cloudflare and in the gitignored local `.env` — never
  committed.

## Runbook

```sh
# One-time, already done: create the DB, wire its id into wrangler.toml,
# set the secret.
wrangler d1 create habit-db
printf '%s' "$KEY" | wrangler secret put ANTHROPIC_API_KEY --env production

# Every deploy:
npm run db:migrate:remote     # apply any new migrations to the live D1
npm run seed:remote           # upsert the habit library (safe to re-run)
npm run deploy                # build + wrangler deploy --env production
```

`npm run deploy` runs the full build (four tsc passes + vite) first, so a type
error blocks the deploy.

## Known gap — sign-in does not work in production yet

`ConsoleEmailSender` is still the only email path (CLAUDE.md §15 #2 is
unresolved: Resend vs MailChannels). Magic links are `console.log`'d, not
emailed — visible only via `wrangler tail`. So although the app is deployed and
the daily loop works once a session exists, **a real user cannot complete
sign-up** until an email provider is wired. This is the top thing standing
between "deployed" and "a stranger can use it".

Also note: there is no onboarding UI yet (the endpoint exists, nothing calls
it), so even a signed-in user lands on Today with the default profile. See
`docs/RUN-2-NOTES.md` → punch list.
