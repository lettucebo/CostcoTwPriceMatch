import type { Env } from '../env.js'
import type {
  SubscriptionRow,
  UserRow,
  NotifyPayload,
} from '@costco/shared'
import { dispatch } from '../notify/dispatch.js'

export interface SnapshotDiffResult {
  events: number
  new_onsale: number
  ended_onsale: number
  restocked: number
  new_best_buy: number
  notifications: number
}

/**
 * Compare today's daily_snapshots vs yesterday's to surface:
 *   - new_onsale: had no discount yesterday, has one today
 *   - ended_onsale: had a discount yesterday, none today
 *   - restocked: out of stock yesterday, in stock today
 *   - new_best_buy: price ends in 7 today but didn't yesterday (manager special)
 *
 * Then notify users subscribed to those event types.
 */
export async function runSnapshotDiff(
  env: Env,
  today: string,
): Promise<SnapshotDiffResult> {
  const out: SnapshotDiffResult = {
    events: 0,
    new_onsale: 0,
    ended_onsale: 0,
    restocked: 0,
    new_best_buy: 0,
    notifications: 0,
  }

  const yesterday = isoDateMinusDays(today, 1)

  // Pull today + yesterday side-by-side
  const { results } = await env.DB
    .prepare(
      `SELECT
         t.product_code AS code,
         t.price AS today_price,
         t.has_discount AS today_discount,
         t.in_stock AS today_in_stock,
         y.price AS yesterday_price,
         y.has_discount AS yesterday_discount,
         y.in_stock AS yesterday_in_stock,
         p.zh_name, p.image_url, p.url
       FROM daily_snapshots t
       LEFT JOIN daily_snapshots y
         ON y.product_code = t.product_code AND y.snapshot_date = ?
       JOIN products p ON p.code = t.product_code
       WHERE t.snapshot_date = ?`,
    )
    .bind(yesterday, today)
    .all<{
      code: string
      today_price: number
      today_discount: 0 | 1
      today_in_stock: 0 | 1
      yesterday_price: number | null
      yesterday_discount: 0 | 1 | null
      yesterday_in_stock: 0 | 1 | null
      zh_name: string
      image_url: string | null
      url: string
    }>()

  const newOnsale: typeof results = []
  const endedOnsale: typeof results = []
  const restocked: typeof results = []
  const newBestBuy: typeof results = []

  for (const r of results) {
    // Skip if no yesterday baseline (new product) — too noisy.
    if (r.yesterday_discount == null) continue

    if (r.today_discount && !r.yesterday_discount) newOnsale.push(r)
    if (!r.today_discount && r.yesterday_discount) endedOnsale.push(r)
    if (r.today_in_stock && r.yesterday_in_stock === 0) restocked.push(r)
    if (
      Math.round(r.today_price) % 10 === 7 &&
      Math.round(r.yesterday_price ?? 0) % 10 !== 7
    )
      newBestBuy.push(r)
  }

  out.new_onsale = newOnsale.length
  out.ended_onsale = endedOnsale.length
  out.restocked = restocked.length
  out.new_best_buy = newBestBuy.length
  out.events = out.new_onsale + out.ended_onsale + out.restocked + out.new_best_buy

  // Notify subscribers
  // - 'new_onsale' subscribers get a digest of newOnsale (top 5)
  // - 'new_best_buy' subscribers get newBestBuy (top 5)
  // - 'restock' subscribers get items matching their product_code

  const sentNewOnsale = await notifyDigest(
    env,
    'new_onsale',
    {
      kind: 'new_onsale_digest',
      title: `今日新進特價 ${out.new_onsale} 件商品`,
      body: '部分商品開始降價中，建議追蹤的商品也可申請退差價。',
      url: `${env.APP_BASE_URL}/`,
      items: newOnsale.slice(0, 5).map((r) => ({
        code: r.code,
        name: r.zh_name,
        image_url: r.image_url,
        current_price: r.today_price,
      })),
    },
    out.new_onsale > 0,
  )
  out.notifications += sentNewOnsale

  const sentBestBuy = await notifyDigest(
    env,
    'new_best_buy',
    {
      kind: 'new_best_buy_digest',
      title: `今日新進經理特價（價尾 7）${out.new_best_buy} 件`,
      body: '價格尾數為 7 的商品通常是出清品 / 經理特價。',
      url: `${env.APP_BASE_URL}/`,
      items: newBestBuy.slice(0, 5).map((r) => ({
        code: r.code,
        name: r.zh_name,
        image_url: r.image_url,
        current_price: r.today_price,
      })),
    },
    out.new_best_buy > 0,
  )
  out.notifications += sentBestBuy

  // Per-product restock subscriptions
  if (restocked.length) {
    const codes = restocked.map((r) => r.code)
    const placeholders = codes.map(() => '?').join(',')
    const subs = await env.DB
      .prepare(
        `SELECT s.id, s.user_id, s.product_code
         FROM subscriptions s
         WHERE s.type = 'restock' AND s.product_code IN (${placeholders})`,
      )
      .bind(...codes)
      .all<SubscriptionRow>()
    const restockedByCode = new Map(restocked.map((r) => [r.code, r]))
    for (const s of subs.results) {
      const item = s.product_code ? restockedByCode.get(s.product_code) : null
      if (!item) continue
      const user = await env.DB
        .prepare('SELECT * FROM users WHERE id = ?')
        .bind(s.user_id)
        .first<UserRow>()
      if (!user) continue
      const payload: NotifyPayload = {
        kind: 'restock',
        title: `補貨通知：${truncate(item.zh_name, 32)}`,
        body: `您追蹤的商品 #${item.code} 已恢復供貨。`,
        url: item.url,
        items: [
          {
            code: item.code,
            name: item.zh_name,
            image_url: item.image_url,
            current_price: item.today_price,
          },
        ],
      }
      try {
        const results = await dispatch(env, user, payload)
        out.notifications += results.filter((r) => r.status === 'sent').length
      } catch (err) {
        console.error('[snapshot-diff] restock dispatch failed', err)
      }
    }
  }

  return out
}

/**
 * Send a single digest payload to every user subscribed to `type`.
 * Returns the number of notifications successfully sent.
 */
async function notifyDigest(
  env: Env,
  type: 'new_onsale' | 'new_best_buy',
  payload: NotifyPayload,
  hasItems: boolean,
): Promise<number> {
  if (!hasItems) return 0
  const { results: subs } = await env.DB
    .prepare(
      `SELECT DISTINCT user_id FROM subscriptions WHERE type = ?`,
    )
    .bind(type)
    .all<{ user_id: number }>()
  let sent = 0
  for (const s of subs) {
    const user = await env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(s.user_id)
      .first<UserRow>()
    if (!user) continue
    try {
      const results = await dispatch(env, user, payload)
      sent += results.filter((r) => r.status === 'sent').length
    } catch (err) {
      console.error(`[snapshot-diff] ${type} dispatch failed`, err)
    }
  }
  return sent
}

function isoDateMinusDays(today: string, days: number): string {
  const d = new Date(today + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
