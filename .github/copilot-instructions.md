# Project Guidelines

> **個人用**的 Costco 台灣商品價格追蹤 PWA。詳細介紹見 [`README.md`](../README.md)；部署 / 維運見 [`RUNBOOK.md`](../RUNBOOK.md)；完整架構決策保存在 GitHub Issue [#1 EPIC](https://github.com/lettucebo/CostcoTwPriceMatch/issues/1)。

## Architecture

pnpm monorepo（pnpm-only，`preinstall` 會擋 npm/yarn）。所有原始碼放在 `src/` 底下，4 個 packages：

```
src/
  apps/web        Vite + React 18 + TailwindCSS + vite-plugin-pwa (injectManifest) → Cloudflare Pages
  apps/api        Hono on Cloudflare Workers → workers.dev
  packages/shared TS types + Zod schemas + constants（被前後端共用）
  packages/scraper Costco TW REST API client（純函式 + vitest + fixtures）
  migrations/     D1 SQL migrations（9 個資料表）
  tsconfig.base.json
```

關鍵服務拆法：
- `src/apps/api/src/routes/*` 只負責路由 + zod 驗證 + 呼叫 service
- `src/apps/api/src/services/*` 是業務邏輯（products、watchlist、receipts、price-match、snapshot-diff）
- `src/apps/api/src/notify/*` 通知層：`Notifier` 介面 + `dispatch()` 路由器，現有 4 個實作（email / line / telegram / webpush）
- `src/apps/api/src/cron/daily-fetch.ts` 是排程進入點，把 services 串起來
- `src/apps/api/src/auth/*` 是 Google OAuth + HS256 session JWT + `requireAuth` middleware

## Code Style

- **TypeScript strict**，全部 ESM（`"type": "module"`）
- **import 路徑加 `.js`**（even for `.ts` 檔案）— 例：`import { x } from './foo.js'`。這是 NodeNext / Workers ESM 的硬性需求，Vitest 也吃這個格式。
- **D1 query**：用 `prepare(...).bind(...).first()` / `.all<RowType>()` / `.run()`，型別參數對齊 [`src/packages/shared/src/types.ts`](../src/packages/shared/src/types.ts) 裡的 `*Row` interface。
- **HTTP request body 驗證**：永遠用 [`src/packages/shared/src/schemas.ts`](../src/packages/shared/src/schemas.ts) 裡的 zod schema（`.parse(await c.req.json())`），不要手寫驗證。
- **TailwindCSS components**：共用 class 看 [`src/apps/web/src/index.css`](../src/apps/web/src/index.css)（`btn`、`btn-primary`、`btn-ghost`、`card`、`badge`）。預設深色主題（`<html class="dark">`、`color-scheme: dark`）。
- **不寫無謂註解**，但**所有跨檔案的服務函式要寫一行 JSDoc** 說明用途。
- 介面文字用**繁體中文**（zh-Hant-TW），程式碼註解 / commit message / PR 描述用英文。

## Build and Test

專案是 **pnpm-only**：根目錄 `package.json` 有 `preinstall: only-allow pnpm`，`npm install` / `yarn` 會被擋。所有 `wrangler` 指令都透過 `pnpm exec` / `pnpm --filter @costco/api exec wrangler ...` 跑，避免抓到全域舊版。

```bash
pnpm install                              # 一次性
pnpm dev                                  # 同時起 web (5173) + api worker (8787)，Vite 自動 proxy /api /auth
pnpm typecheck                            # tsc -b 全部 4 個 packages
pnpm test                                 # 全部單元測試（目前 28 顆）
pnpm --filter @costco/web run build       # 產 PWA 靜態檔到 src/apps/web/dist
pnpm --filter @costco/api run db:migrate:local   # apply migrations 到本機 D1
pnpm --filter @costco/api run db:tables   # 列本機 D1 所有表
```

## Costco TW REST API（這個專案唯一的資料來源）

**就是這兩個端點，與 Costco 手機 App 後端同源（SAP Hybris OCC v2）：**

```
GET https://www.costco.com.tw/rest/v2/taiwan/products/search
    ?pageSize=100&currentPage=N&sort=price-asc&lang=zh_TW&curr=TWD&category=hot-buys

GET https://www.costco.com.tw/rest/v2/taiwan/products/{code}?lang=zh_TW&curr=TWD
```

封裝在 [`src/packages/scraper/src/client.ts`](../src/packages/scraper/src/client.ts)。**永遠透過 `fetchAllByCategory` / `fetchProductByCode` / `searchProducts`，不要直接 `fetch`** — 客戶端已內建 3 次指數 backoff、404→null、自訂 UA。Headers 必填 `Accept: application/json`、`User-Agent: ... CostcoTwPriceMatch/1.0 (personal use)`。

特價偵測規則（也都已寫在 [`src/packages/scraper/src/parser.ts`](../src/packages/scraper/src/parser.ts)）：
| 規則 | 邏輯 |
| --- | --- |
| 正在特價 | `discountPrice` 欄位存在且 `value > 0` |
| 經理特價 / 出清 | `price.value` 整數尾數 = 7 |
| 補貨 | 上次 snapshot `in_stock=0` 但今天 `in_stock=1` |
| 退差價可申請 | `current_price < purchase_price` 且 `today − purchase_date ≤ 30` 天 |

## Conventions

- **Issue 進度同步**：開工先 `gh issue comment <n> --body "🚧 Started — branch: ..."`；完工 `gh issue comment <n> --body "✅ Done — commit: <sha>"`；不要在實作中關閉 issue，留給 PR merge 自動 close。
- **Commit message** 格式：`feat(#<issue>): <短說明>` / `fix(#<issue>): ...` / `chore: ...`，body 用 bullet list 列出實際改動。
- **PR**：用 `Closes #N` 一口氣關掉所有相關 issue。
- **Worker secrets**：dev 用 [`src/apps/api/.dev.vars`](../src/apps/api/.dev.vars.example)，prod 用 `pnpm exec wrangler secret put`。秘密一律不入 git。完整清單在 [`RUNBOOK.md`](../RUNBOOK.md)。
- **個人用聲明**：本專案是私人工具。請求 Costco TW 端點時禮貌限頻 ≤ 1 req/sec，不要做成商用對外服務。

## Common Gotchas

- **Cloudflare Workers Free Plan**：單次 invoke 50 sub-requests / 10 ms CPU。daily cron 已用「fetch hot-buys + whats-new + 補抓 watchlist 缺的」分批策略避開上限。新加的 service 若要呼叫多家外部 API，先估 sub-request 數。
- **Web Crypto vs Node `crypto`**：Worker runtime **不支援** Node 的 `crypto`；VAPID + AES-GCM 都用 Web Crypto API ([`src/apps/api/src/notify/webpush-protocol.ts`](../src/apps/api/src/notify/webpush-protocol.ts))。**不要 `import { ... } from 'node:crypto'`**。
- **ArrayBuffer vs SharedArrayBuffer**：TS 嚴格模式下 `Uint8Array.buffer` 可能是 `SharedArrayBuffer`。需要轉 ArrayBuffer 時，**永遠用 `new ArrayBuffer(n)` + `new Uint8Array(buf).set(b)` 複製**，不要 `b.buffer.slice(0)`。
- **`scraper/test/*.test.ts` rootDir 衝突**：[`src/packages/scraper/tsconfig.json`](../src/packages/scraper/tsconfig.json) 故意沒有 `rootDir` 設定，**不要加回去**。
- **D1 datetime**：用 SQLite 內建 `datetime('now')` 與 `julianday('now') - julianday(date)`。30 天計算用 [`src/apps/api/src/services/products.ts`](../src/apps/api/src/services/products.ts) 的 `computeDays`，已處理跨午夜邊界。
- **vite-plugin-pwa**：本專案用 `injectManifest` 策略（為了 Web Push 的 custom SW），**不要切回 `generateSW`**；改 SW 邏輯改 [`src/apps/web/src/sw.ts`](../src/apps/web/src/sw.ts)。
- **Resend 免費額度**：100 封/天、3000 封/月。`dispatch()` 已有同日同 (item, price) 去重；新增大量通知前確認不會炸額度。
- **LINE Notify 已停服 (2025-03-31)**：通知用的是 **LINE Messaging API（push message）**，需要 Channel Access Token + 使用者 LINE userId。
- **Costco 會員專屬價**：本專案**不做**。某些商品 `price` 為 null（`hidePriceValue: true` / `membershipRestrictionApplied: true`），`toProductSummary()` 會 throw — 呼叫端要 try/catch 跳過。

## Useful References

- 計畫定稿（含階段拆解、執行手冊、風險）：[plan.md](../../memories/session/plan.md)（session memory）
- Costco 退差價政策實際條款 / 檔期週期研究：EPIC [#1](https://github.com/lettucebo/CostcoTwPriceMatch/issues/1) 的 body
- 啟發本專案的開源專案（4 年前的個人作品，已不維護但確認 API 仍可用）：<https://github.com/CostcoTW-Notify>
