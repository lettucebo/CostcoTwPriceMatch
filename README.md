# Costco TW Price Match 追蹤站

> 個人用 Cloudflare PWA。追蹤 Costco 台灣商品價格，自動偵測 30 天內降價並提醒申請退差價。

## Stack

- **Frontend**: Cloudflare Pages + React + Vite + TailwindCSS + vite-plugin-pwa
- **Backend**: Cloudflare Workers + Hono (TypeScript)
- **Database**: Cloudflare D1 (SQLite)
- **Scheduler**: Cloudflare Cron Triggers
- **Auth**: Google OAuth 2.0 + JWT (HS256, HttpOnly cookie)
- **Notifications**: Resend Email (主), LINE Messaging API / Telegram (擴充), Web Push (PWA)
- **LLM**: Cloudflare Workers AI (Llama 3.2 Vision，發票 OCR)
- **Data source**: [Costco TW SAP Hybris OCC v2 REST API](https://www.costco.com.tw/rest/v2/taiwan/products/...) — 與 Costco App 同源

## Repo layout

```
apps/
  web/        # React + Vite SPA (Cloudflare Pages)
  api/        # Hono Worker + D1 (Cloudflare Workers)
packages/
  shared/     # Shared TS types + Zod schemas
  scraper/    # Costco TW REST API client + tests
migrations/   # D1 SQL migrations
```

## Local dev

### One-time

```bash
# Install pnpm 9+ and Node 20+
pnpm install

# Copy env templates
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/web/.env.example      apps/web/.env.local
# Then edit those files with real values

# Create local D1 + apply migrations
pnpm --filter @costco/api run db:migrate:local
```

### Run

```bash
pnpm dev          # starts both web (5173) and API worker (8787)
```

The Vite dev server proxies `/api/*` and `/auth/*` to the Worker.

### Test

```bash
pnpm test         # all package tests
pnpm typecheck    # tsc on every package
```

## Deploy

```bash
# 1. Provision D1 + KV (one-time)
wrangler d1 create costco-tw-price-match
wrangler kv namespace create KV_CACHE
# Update apps/api/wrangler.jsonc with the IDs printed.

# 2. Apply migrations to remote D1
pnpm --filter @costco/api run db:migrate:remote

# 3. Set secrets
cd apps/api
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put JWT_SECRET
wrangler secret put INTERNAL_BEARER
wrangler secret put RESEND_API_KEY
# Optional:
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT

# 4. Deploy Worker
wrangler deploy

# 5. Deploy Pages (via GitHub integration is easiest)
#    Connect lettucebo/CostcoTwPriceMatch in Cloudflare Pages,
#    build command:    pnpm --filter @costco/web run build
#    build output dir: apps/web/dist
```

## Costco TW REST API (the data source)

```
GET https://www.costco.com.tw/rest/v2/taiwan/products/search
  ?pageSize=100&currentPage=0&sort=price-asc&lang=zh_TW&curr=TWD
  &category=hot-buys

GET https://www.costco.com.tw/rest/v2/taiwan/products/{code}
  ?lang=zh_TW&curr=TWD
```

### Specials detection rules

| Rule | Logic |
| --- | --- |
| 正在特價 | `discountPrice` 欄位存在且 `value > 0` |
| 經理特價 / 出清 | `price.value` 整數尾數 = 7 |
| 補貨 | 上次 snapshot `in_stock=0` 但今天 `in_stock=1` |
| 退差價可申請 | `current_price < purchase_price` 且 `today - purchase_date <= 30` |

## Disclaimer

This project is for **personal use only**. It interacts with publicly accessible
Costco TW endpoints at low rate. Do not redeploy publicly without reviewing
Costco TW Terms & Conditions.
