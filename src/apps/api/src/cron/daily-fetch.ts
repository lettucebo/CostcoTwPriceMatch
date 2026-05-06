import type { Env } from '../env.js'
import {
  fetchAllByCategory,
  fetchProductByCode,
  toProductSummary,
  type CostcoApiProduct,
} from '@costco/scraper'
import { upsertProduct, appendPriceHistory } from '../services/products.js'
import { runPriceMatch } from '../services/price-match.js'
import { runSnapshotDiff } from '../services/snapshot-diff.js'
import { alertThreshold, sendCronAlert } from '../notify/alert.js'

export interface DailyFetchOptions {
  trigger: 'cron' | 'manual'
  cron?: string
  /** Override "today" for tests; YYYY-MM-DD UTC. */
  today?: string
}

export interface DailyFetchResult {
  ok: boolean
  trigger: string
  duration_ms: number
  hot_buys_fetched: number
  whats_new_fetched: number
  watchlist_individually_fetched: number
  errors: number
  notifications_sent: number
  snapshot_events: number
  job_id?: number
}

/**
 * Daily cron entry point.
 *
 * Steps:
 *   1) fetch hot-buys (full pagination)
 *   2) fetch whats-new (full pagination)
 *   3) fetch any watchlist products not covered by 1+2
 *   4) upsert all into `products`, append `price_history`, write `daily_snapshots`
 *   5) run price-match detection + send notifications (#6)
 *   6) run snapshot-diff (#8)
 */
export async function runDailyFetch(
  env: Env,
  opts: DailyFetchOptions,
): Promise<DailyFetchResult> {
  const start = Date.now()
  const today = opts.today ?? new Date().toISOString().slice(0, 10)

  // Insert scrape_jobs row up-front
  const jobIns = await env.DB
    .prepare(
      `INSERT INTO scrape_jobs (type, target, status, started_at)
       VALUES (?, ?, 'running', datetime('now'))
       RETURNING id`,
    )
    .bind('daily-fetch', opts.trigger)
    .first<{ id: number }>()
  const jobId = jobIns?.id

  let hotBuys: CostcoApiProduct[] = []
  let whatsNew: CostcoApiProduct[] = []
  let individuallyFetched = 0
  let errors = 0

  try {
    hotBuys = await fetchAllByCategory('hot-buys')
  } catch (err) {
    console.error('[cron] hot-buys fetch failed', err)
    errors++
  }

  try {
    whatsNew = await fetchAllByCategory('whats-new')
  } catch (err) {
    console.error('[cron] whats-new fetch failed', err)
    errors++
  }

  // Index by code to dedupe
  const byCode = new Map<string, CostcoApiProduct>()
  for (const p of hotBuys) byCode.set(p.code, p)
  for (const p of whatsNew) if (!byCode.has(p.code)) byCode.set(p.code, p)

  // Watchlist codes not yet covered
  const { results: watchlistCodes } = await env.DB
    .prepare(
      `SELECT DISTINCT product_code FROM watchlist_items
       WHERE status IN ('active', 'price_match_eligible')`,
    )
    .all<{ product_code: string }>()
  const missing = watchlistCodes
    .map((r) => r.product_code)
    .filter((c) => !byCode.has(c))
  for (const code of missing) {
    try {
      const p = await fetchProductByCode(code)
      if (p) {
        byCode.set(p.code, p)
        individuallyFetched++
      }
    } catch (err) {
      console.error(`[cron] individual fetch ${code} failed`, err)
      errors++
    }
  }

  // Persist all
  for (const raw of byCode.values()) {
    try {
      await upsertProduct(env.DB, raw)
      await appendPriceHistory(env.DB, raw)
      await writeDailySnapshot(env, today, raw)
    } catch (err) {
      console.error(`[cron] persist ${raw.code} failed`, err)
      errors++
    }
  }

  // Price match + snapshot diff
  let notificationsSent = 0
  let snapshotEvents = 0
  try {
    const r = await runPriceMatch(env)
    notificationsSent += r.notifications
  } catch (err) {
    console.error('[cron] price match failed', err)
    errors++
  }
  try {
    const r = await runSnapshotDiff(env, today)
    snapshotEvents = r.events
    // runSnapshotDiff returns its own count for digests + restock alerts.
    // Previously this was discarded, making `notifications_sent` in the meta
    // under-report every snapshot notification.
    notificationsSent += r.notifications
  } catch (err) {
    console.error('[cron] snapshot diff failed', err)
    errors++
  }

  const result: DailyFetchResult = {
    ok: errors === 0,
    trigger: opts.trigger,
    duration_ms: Date.now() - start,
    hot_buys_fetched: hotBuys.length,
    whats_new_fetched: whatsNew.length,
    watchlist_individually_fetched: individuallyFetched,
    errors,
    notifications_sent: notificationsSent,
    snapshot_events: snapshotEvents,
    job_id: jobId,
  }

  if (jobId) {
    await env.DB
      .prepare(
        `UPDATE scrape_jobs
         SET status = ?, finished_at = datetime('now'), meta = ?
         WHERE id = ?`,
      )
      .bind(errors === 0 ? 'success' : 'failed', JSON.stringify(result), jobId)
      .run()
  }

  // Alert the maintainer when the cron run accumulated too many errors.
  // Only trigger for actual cron-driven runs — manual invocations via
  // /api/internal/cron/daily-fetch are typically debugging or maintenance
  // and would otherwise spam the alert channel. Errors are still recorded in
  // scrape_jobs.meta either way.
  // Best-effort — failures here never propagate.
  const threshold = alertThreshold(env)
  if (opts.trigger === 'cron' && threshold > 0 && errors >= threshold) {
    await sendCronAlert(env, `Daily cron had ${errors} error(s)`, {
      ...result,
      cron: opts.cron,
      threshold,
    })
  }

  return result
}

async function writeDailySnapshot(
  env: Env,
  today: string,
  raw: CostcoApiProduct,
): Promise<void> {
  const s = toProductSummary(raw)
  await env.DB
    .prepare(
      `INSERT INTO daily_snapshots
        (snapshot_date, product_code, price, has_discount, in_stock)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (snapshot_date, product_code) DO UPDATE SET
         price = excluded.price,
         has_discount = excluded.has_discount,
         in_stock = excluded.in_stock`,
    )
    .bind(today, s.code, s.current_price, s.is_on_sale ? 1 : 0, s.in_stock ? 1 : 0)
    .run()
}
