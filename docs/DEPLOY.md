# Deployment

First deployed 2026-07-21 (interactive session). Cloudflare account
`stevie.johnston@gmail.com` (`5bdc4d78…`), authenticated via a
`CLOUDFLARE_API_TOKEN` the harness injects into wrangler.

## Live URLs

| URL | What |
|---|---|
| `https://habit.clydeford.net` | Production. Custom domain, the canonical entrance. Matches the magic-link base URL in `src/worker/magic-link.ts`. |
| `https://clydeford-habits.stevie-johnston.workers.dev` | Same Worker script, workers.dev URL. Useful for debugging; serves the **same production data**. Disable with `workers_dev = false` if a single canonical URL is wanted. |

> An earlier deploy briefly attached `app.clydeford.net` before switching to
> `habit.clydeford.net`. If a stray `app.clydeford.net` custom domain or DNS
> record lingers, remove it in the dashboard: **Workers & Pages →
> clydeford-habits → Settings → Domains & Routes** (remove the custom domain),
> then delete any leftover `app` record under **clydeford.net → DNS**.

Both are the **same** Worker (`clydeford-habits`) bound to the **same** D1
database — `[env.production]` deliberately reuses the name and DB of the default
env; the split exists so a future staging env can point at its own D1.

## Resources

- **D1 database:** `habit-db`, id `d4273a52-23dc-4b5a-b593-7e8c1278abad`, region WEUR.
- **Static assets:** the built `dist/` (`[assets]` in `wrangler.toml`). Files
  are served directly; non-file paths (`/api/*`, `/health`) fall through to the
  Hono Worker.
- **Secrets:** `ANTHROPIC_API_KEY` is set on the Worker. `RESEND_API_KEY` is
  **not yet set** (see "Email / Resend" below). Optional `EMAIL_FROM` overrides
  the sender address (default `Clydeford Habits <noreply@clydeford.net>`).
  Secrets live only in Cloudflare and the gitignored `.env` — never committed.

## Email / Resend

Magic-link email goes through Resend (`src/worker/resend-email.ts`). The Worker
picks the sender at runtime: `RESEND_API_KEY` set → Resend; unset → console
logging (`wrangler tail` to see the link). No redeploy is needed after setting
the key — it takes effect on the next request.

Two one-time steps make real email work:

1. **Verify the sending domain in Resend.** In the Resend dashboard, add
   `clydeford.net` (or a subdomain like `send.clydeford.net`) and add the
   DKIM/SPF DNS records it gives you to the **clydeford.net** zone (already on
   this Cloudflare account). Until the domain shows "verified", Resend rejects
   sends with a 422 and the endpoint returns `email_send_failed` (502).
2. **Set the API key** (run in your own terminal so the key isn't echoed):
   ```sh
   wrangler secret put RESEND_API_KEY --env production
   # paste the re_… key at the hidden prompt
   ```

To send from a different address, also set `EMAIL_FROM` — it must be on the
verified domain:
```sh
wrangler secret put EMAIL_FROM --env production   # e.g. "Clydeford Habits <hello@clydeford.net>"
```

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
