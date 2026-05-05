import type { Env } from '../env.js'
import type {
  UserRow,
  WatchlistItemRow,
  NotifyPayload,
} from '@costco/shared'
import { computeDays } from './products.js'
import { dispatch } from '../notify/dispatch.js'

export interface PriceMatchResult {
  eligible: number
  expired: number
  notifications: number
  errors: number
}

const DAILY_DIGEST_LIMIT = 5

/**
 * Run after the daily fetch.
 *
 * 1) Mark items past 30 days as 'expired'.
 * 2) For active items where current_price < purchase_price and within 30 days,
 *    mark as 'price_match_eligible' and queue a notification.
 * 3) Group eligible items per user into a single digest email per channel,
 *    capped at DAILY_DIGEST_LIMIT items per user/day.
 * 4) De-duplicate against notifications_log so we don't re-notify the same
 *    (item, current_price) tuple.
 */
export async function runPriceMatch(env: Env): Promise<PriceMatchResult> {
  const out: PriceMatchResult = {
    eligible: 0,
    expired: 0,
    notifications: 0,
    errors: 0,
  }
  const today = new Date()

  // 1) expire old ones first
  const expireRes = await env.DB
    .prepare(
      `UPDATE watchlist_items
       SET status = 'expired',
           updated_at = datetime('now')
       WHERE status IN ('active','price_match_eligible')
         AND julianday('now') - julianday(purchase_date) > 30`,
    )
    .run()
  out.expired = expireRes.meta.changes ?? 0

  // 2) find candidates
  const { results } = await env.DB
    .prepare(
      `SELECT
         w.id, w.user_id, w.product_code, w.purchase_price, w.purchase_date,
         w.status, w.notes, w.created_at, w.updated_at,
         p.zh_name, p.current_price, p.base_price, p.image_url, p.url
       FROM watchlist_items w
       JOIN products p ON p.code = w.product_code
       WHERE w.status IN ('active','price_match_eligible')
         AND p.current_price < w.purchase_price`,
    )
    .all<
      WatchlistItemRow & {
        zh_name: string
        current_price: number
        base_price: number | null
        image_url: string | null
        url: string
      }
    >()

  // Group by user
  const byUser = new Map<number, typeof results>()
  for (const r of results) {
    const days = computeDays(r.purchase_date, today)
    if (days.days_remaining <= 0) continue
    const arr = byUser.get(r.user_id) ?? []
    arr.push(r)
    byUser.set(r.user_id, arr)
  }
  out.eligible = [...byUser.values()].reduce((n, a) => n + a.length, 0)

  // Mark all eligible
  if (out.eligible > 0) {
    const ids = [...byUser.values()].flat().map((r) => r.id)
    const placeholders = ids.map(() => '?').join(',')
    await env.DB
      .prepare(
        `UPDATE watchlist_items
         SET status = 'price_match_eligible', updated_at = datetime('now')
         WHERE id IN (${placeholders})`,
      )
      .bind(...ids)
      .run()
  }

  // 3) build & send digests
  for (const [userId, items] of byUser) {
    const user = await env.DB
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(userId)
      .first<UserRow>()
    if (!user) continue

    // 4) de-dup: filter out items we've already sent for at this exact price.
    const top = items.slice(0, DAILY_DIGEST_LIMIT)
    const codes = top.map((r) => r.product_code)
    const placeholders = codes.map(() => '?').join(',')
    const sent = codes.length
      ? await env.DB
          .prepare(
            `SELECT json_extract(payload, '$.items') AS items_json
             FROM notifications_log
             WHERE user_id = ? AND status = 'sent'
               AND date(sent_at) = date('now')`,
          )
          .bind(userId)
          .all<{ items_json: string | null }>()
      : { results: [] as { items_json: string | null }[] }

    const alreadySent = new Set<string>()
    for (const row of sent.results) {
      if (!row.items_json) continue
      try {
        const arr = JSON.parse(row.items_json) as Array<{
          code: string
          current_price: number
        }>
        for (const it of arr) alreadySent.add(`${it.code}@${it.current_price}`)
      } catch {
        // ignore malformed
      }
    }

    const newItems = top.filter(
      (r) => !alreadySent.has(`${r.product_code}@${r.current_price}`),
    )
    if (newItems.length === 0) continue

    const payload: NotifyPayload = {
      kind: 'price_match',
      title:
        newItems.length === 1
          ? `【Costco 退差價】${truncate(newItems[0]!.zh_name, 32)} 已降價`
          : `【Costco 退差價】您追蹤的 ${newItems.length} 件商品已降價`,
      body: '在 30 天內購買，可至 Costco 客服櫃台或線上申請退差價。',
      url: `${env.APP_BASE_URL}/`,
      items: newItems.map((r) => {
        const days = computeDays(r.purchase_date, today)
        return {
          code: r.product_code,
          name: r.zh_name,
          image_url: r.image_url,
          purchase_price: r.purchase_price,
          current_price: r.current_price,
          diff: r.purchase_price - r.current_price,
          days_remaining: days.days_remaining,
        }
      }),
    }

    try {
      const results = await dispatch(env, user, payload, {
        watchlistItemId: newItems[0]!.id, // primary anchor for dedup logging
      })
      out.notifications += results.filter((r) => r.status === 'sent').length
    } catch (err) {
      console.error('[price-match] dispatch failed', err)
      out.errors++
    }
  }

  return out
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
