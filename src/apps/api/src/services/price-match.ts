import type { Env } from '../env.js'
import type {
  NotificationChannel,
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

const DEFAULT_DAILY_DIGEST_LIMIT = 5

/** Read PRICE_MATCH_DAILY_CAP env var (string), clamp to [1, 100], default 5. */
function dailyDigestLimit(env: Env): number {
  const raw = (env as unknown as { PRICE_MATCH_DAILY_CAP?: string })
    .PRICE_MATCH_DAILY_CAP
  if (raw == null) return DEFAULT_DAILY_DIGEST_LIMIT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAILY_DIGEST_LIMIT
  return Math.min(Math.floor(n), 100)
}

/**
 * Run after the daily fetch.
 *
 * 1) Mark items past 30 days as 'expired'.
 * 2) For active items where current_price < purchase_price and within 30 days,
 *    mark as 'price_match_eligible' and queue a notification.
 * 3) Group eligible items per user into a single digest email per channel,
 *    capped at PRICE_MATCH_DAILY_CAP items per user/day (default 5).
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

  // 1) expire old ones first.
  // Use whole-day arithmetic (`julianday(date('now'))`) so an item purchased on
  // day-30 isn't accidentally expired by the cron's wall-clock time-of-day.
  const expireRes = await env.DB
    .prepare(
      `UPDATE watchlist_items
       SET status = 'expired',
           updated_at = datetime('now')
       WHERE status IN ('active','price_match_eligible')
         AND julianday(date('now')) - julianday(purchase_date) > 30`,
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

  // Group by user. days_remaining === 0 is the LAST valid day, so the boundary
  // is `< 0` not `<= 0`.
  const byUser = new Map<number, typeof results>()
  for (const r of results) {
    const days = computeDays(r.purchase_date, today)
    if (days.days_remaining < 0) continue
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

    // 4) Per-item dedup against notifications_log.dedup_key.
    //    Order matters: filter dedup FIRST, then apply the daily cap. The
    //    previous implementation did slice() before dedup, so if the first 5
    //    rows were already notified, items 6..N were silently dropped instead
    //    of being delivered.
    //
    //    The lookup is chunked at 50 candidates/query so a user with many
    //    eligible items cannot exceed D1's 100 bound-parameter limit (we use
    //    1 slot for user_id + N slots for the IN list).
    const candidateKeys = items.map((r) =>
      priceMatchDedupKey(r.id, r.current_price),
    )
    const alreadySent = await loadAlreadySentKeys(env, userId, candidateKeys)

    const dailyCap = dailyDigestLimit(env)
    const newItems = items
      .filter(
        (r) => !alreadySent.has(priceMatchDedupKey(r.id, r.current_price)),
      )
      .slice(0, dailyCap)
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
      // dispatch() writes the digest payload once per channel anchored at the
      // *primary* dedup key (item 0). For cross-day dedup to actually work for
      // items 1..N-1 we additionally write zero-payload "marker" rows for each
      // secondary item, so the next cron's `loadAlreadySentKeys` finds them.
      const primaryKey = priceMatchDedupKey(
        newItems[0]!.id,
        newItems[0]!.current_price,
      )
      const results = await dispatch(env, user, payload, {
        watchlistItemId: newItems[0]!.id,
        dedupKey: primaryKey,
      })
      const sentChannels = results
        .filter((r) => r.status === 'sent')
        .map((r) => r.channel)
      out.notifications += sentChannels.length

      // Persist secondary-item markers so future runs see them as "already
      // sent" without resending. One row per (item, channel) that successfully
      // sent — matches dispatch()'s per-channel logging contract.
      if (sentChannels.length > 0 && newItems.length > 1) {
        await persistDigestItemMarkers(
          env,
          userId,
          newItems.slice(1),
          sentChannels,
        )
      }
    } catch (err) {
      console.error('[price-match] dispatch failed', err)
      out.errors++
    }
  }

  return out
}

/**
 * Look up which of `candidateKeys` already have a `status='sent'` row for this
 * user. Chunks the IN(...) into batches of 50 so we stay well under D1's
 * default 100 bound-parameter ceiling (1 for user_id + 50 keys = 51 binds).
 */
async function loadAlreadySentKeys(
  env: Env,
  userId: number,
  candidateKeys: string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (candidateKeys.length === 0) return out
  const CHUNK = 50
  for (let i = 0; i < candidateKeys.length; i += CHUNK) {
    const batch = candidateKeys.slice(i, i + CHUNK)
    const res = await env.DB
      .prepare(
        `SELECT DISTINCT dedup_key FROM notifications_log
         WHERE user_id = ? AND status = 'sent'
           AND dedup_key IN (${batch.map(() => '?').join(',')})`,
      )
      .bind(userId, ...batch)
      .all<{ dedup_key: string }>()
    for (const r of res.results) out.add(r.dedup_key)
  }
  return out
}

/**
 * Insert per-item dedup marker rows for items 2..N of a digest. dispatch()
 * already logged the primary item's row (with full payload) for every channel
 * that succeeded; here we add markers for secondary items so the next cron's
 * dedup query treats them as "already sent" too.
 *
 * Rows have status='sent', dedup_key set, payload='{}' (omitted to keep
 * notifications_log lean). watchlist_item_id ties them to the right row so
 * cascade-delete still works.
 */
async function persistDigestItemMarkers(
  env: Env,
  userId: number,
  secondaryItems: Array<{ id: number; current_price: number }>,
  channels: NotificationChannel[],
): Promise<void> {
  if (secondaryItems.length === 0 || channels.length === 0) return
  const stmts = []
  for (const item of secondaryItems) {
    const key = priceMatchDedupKey(item.id, item.current_price)
    for (const ch of channels) {
      stmts.push(
        env.DB
          .prepare(
            `INSERT INTO notifications_log
               (user_id, watchlist_item_id, channel, payload, status, error, dedup_key)
             VALUES (?, ?, ?, '{}', 'sent', NULL, ?)`,
          )
          .bind(userId, item.id, ch, key),
      )
    }
  }
  await env.DB.batch(stmts)
}

/** Stable dedup key for a price-match notification: `pricematch:<itemId>:<price>` */
function priceMatchDedupKey(watchlistItemId: number, currentPrice: number): string {
  return `pricematch:${watchlistItemId}:${currentPrice}`
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
