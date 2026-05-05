# RUNBOOK — Costco TW Price Match

## Local development

```bash
pnpm install
cp src/apps/api/.dev.vars.example src/apps/api/.dev.vars   # then edit
cp src/apps/web/.env.example      src/apps/web/.env.local  # then edit (usually empty)

pnpm --filter @costco/api run db:migrate:local
pnpm dev   # runs web (5173) + api (8787) in parallel
```

> **pnpm only.** A `preinstall` guard blocks `npm`/`yarn` via `only-allow`. Use `corepack enable` or install pnpm 9 directly.

## Tests

```bash
pnpm test              # all packages
pnpm typecheck         # tsc -b on every package
pnpm --filter @costco/api run test
pnpm --filter @costco/scraper run test
```

Current count: **28 tests** (jwt × 3, compute-days × 6, parser × 10, client × 9).

## Deploy (Cloudflare)

### One-time setup

All `wrangler` invocations go through `pnpm exec` so they use the version pinned
in `src/apps/api/package.json`.

1. **D1 database** — `pnpm --filter @costco/api exec wrangler d1 create costco-tw-price-match`
   - Copy the printed `database_id` into `src/apps/api/wrangler.jsonc`.
2. **KV namespace** — `pnpm --filter @costco/api exec wrangler kv namespace create KV_CACHE`
   - Copy the printed `id` into `src/apps/api/wrangler.jsonc`.
3. **Workers AI binding** is already declared in `wrangler.jsonc`, no setup needed.
4. **Apply migrations remotely**:
   ```bash
   pnpm --filter @costco/api run db:migrate:remote
   ```
5. **Set Worker secrets** (run from the api package so `wrangler.jsonc` is found):
   ```bash
   cd src/apps/api
   pnpm exec wrangler secret put GOOGLE_CLIENT_ID
   pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
   pnpm exec wrangler secret put JWT_SECRET                 # openssl rand -hex 32
   pnpm exec wrangler secret put INTERNAL_BEARER            # openssl rand -hex 32
   pnpm exec wrangler secret put RESEND_API_KEY             # from resend.com
   # Optional channels:
   pnpm exec wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
   pnpm exec wrangler secret put VAPID_PUBLIC_KEY           # from `pnpm dlx web-push generate-vapid-keys`
   pnpm exec wrangler secret put VAPID_PRIVATE_KEY
   pnpm exec wrangler secret put VAPID_SUBJECT              # mailto:you@example.com
   ```
6. **Google OAuth client** at <https://console.cloud.google.com/apis/credentials>
   - Authorized origins: `https://<project>.pages.dev`, `http://localhost:5173`
   - Authorized redirect URIs: `https://<project>.workers.dev/auth/google/callback`,
     `http://localhost:8787/auth/google/callback`

### Deploy

```bash
# Worker:
pnpm --filter @costco/api run deploy

# Pages: connect repo at https://dash.cloudflare.com/?to=/:account/pages,
#   build command:    pnpm --filter @costco/web run build
#   build output dir: src/apps/web/dist
```

## Manual smoke tests

After deploy, run these in order:

| # | Test | Command |
|---|---|---|
| 1 | Worker health | `curl https://<worker>.workers.dev/api/health` → `{"ok":true,...}` |
| 2 | Login flow | Visit `https://<pages>.pages.dev/login`, click Google button, complete login → redirected to `/` |
| 3 | Auth required | `curl https://<worker>.workers.dev/api/me` → 401 |
| 4 | Manual cron | `curl -X POST -H "Authorization: Bearer $INTERNAL_BEARER" https://<worker>.workers.dev/api/internal/cron/daily-fetch` → JSON with `hot_buys_fetched > 0` |
| 5 | Watchlist | Add a real Costco product code from `https://www.costco.com.tw/...` paste; refresh page; card appears |
| 6 | Refresh rate-limit | Click "立即更新" twice within an hour; second call returns 429 |
| 7 | PWA installability | Chrome → Lighthouse → PWA score ≥ 90 |
| 8 | iOS install | iOS Safari → 分享 → 加入主畫面 → opens standalone |

## Operations

### Cron schedule

`15 4 * * *` (UTC) = **每日 12:15 Asia/Taipei**

Logs visible in Cloudflare dashboard → Workers → Logs (real-time tail) or under
`wrangler tail`. Each run inserts a row into `scrape_jobs` with full meta JSON.

### Inspect D1 data

```bash
pnpm --filter @costco/api exec wrangler d1 execute DB --remote --command "SELECT * FROM scrape_jobs ORDER BY id DESC LIMIT 5"
pnpm --filter @costco/api exec wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM products"
pnpm --filter @costco/api exec wrangler d1 execute DB --remote --command "SELECT * FROM notifications_log ORDER BY id DESC LIMIT 10"
```

### Re-run a day's snapshot

```bash
curl -X POST -H "Authorization: Bearer $INTERNAL_BEARER" https://<worker>.workers.dev/api/internal/cron/daily-fetch
```

`daily_snapshots` has `UNIQUE (snapshot_date, product_code)` with upsert, so it is idempotent.

### Stop the cron

Edit `src/apps/api/wrangler.jsonc`, remove `triggers.crons`, redeploy.

## Risk / failure modes

| Failure | Symptom | Mitigation |
|---|---|---|
| Costco REST API changes | `scrape_jobs.status='failed'` for >3 days, `errors > 0` | Switch to GitHub Actions Playwright fallback (issue #13, deferred) |
| Workers Free 50 sub-requests exceeded | Cron returns truncated `hot_buys_fetched` count | Use Cloudflare Workflows to split into multiple steps |
| Workers AI daily neuron quota | OCR endpoint 503 | User can paste their own Azure OpenAI key (BYOK mode in #10) |
| Resend 100/day free limit | `notifications_log.status='failed'` with rate-limit text | Digest already de-duplicates per-user/day |
| OAuth redirect URI mismatch | Login fails with redirect_uri_mismatch | Add the exact URI to Google Cloud Console |

## Cost expectations (free tier)

- Workers Free: 100 k requests/day; we use ~daily cron + a handful of API calls per day.
- D1 Free: 5 GB storage, 25 M rows reads/day. 50 watchlist items × 365 days × 1 row = 18 250 rows/yr.
- KV Free: 100 k reads/day, 1 k writes/day. We use it for OAuth state (10 min TTL) + refresh locks (1 h TTL).
- Workers AI Free: 10 000 neurons/day. Each receipt OCR call ≈ 200–500 neurons.
- Resend Free: 3 000/month, 100/day. Digest collapses to 1 email/user/day.
