import type { Env } from '../env.js'
import type {
  NotificationChannel,
  NotifyPayload,
  UserRow,
} from '@costco/shared'
import { emailNotifier } from './email.js'
import { lineNotifier } from './line.js'
import { telegramNotifier } from './telegram.js'
import { webpushNotifier } from './webpush.js'
import type { Notifier, NotifyResult } from './notifier.js'

const ALL_NOTIFIERS: Notifier[] = [
  emailNotifier,
  lineNotifier,
  telegramNotifier,
  webpushNotifier,
]

export interface DispatchOptions {
  /** Skip de-duplication when set (e.g., user-triggered test send). */
  noDedup?: boolean
  /** Tag this notification to a watchlist item (for cascade-delete + filtering). */
  watchlistItemId?: number
  /**
   * Stable dedup key written into `notifications_log.dedup_key`. If a row with
   * this `(user_id, dedup_key)` already exists with `status = 'sent'`, dispatch
   * is a no-op for that channel. Conventional shapes:
   *   - `pricematch:<itemId>:<currentPrice>`
   *   - `digest:new_onsale:<YYYY-MM-DD>`
   *   - `digest:new_best_buy:<YYYY-MM-DD>`
   *   - `restock:<productCode>:<YYYY-MM-DD>`
   * If omitted, no dedup is performed (legacy behaviour) and the row is logged
   * with `dedup_key = NULL`.
   */
  dedupKey?: string
  /** Optional override of per-user channel selection. */
  forceChannels?: NotificationChannel[]
}

/**
 * Dispatch a notification to a user across their selected channels.
 * Returns the per-channel results. Each result is also written to
 * notifications_log so we can de-dup on subsequent runs.
 */
export async function dispatch(
  env: Env,
  user: UserRow,
  payload: NotifyPayload,
  opts: DispatchOptions = {},
): Promise<NotifyResult[]> {
  const enabled = parseChannels(user.notification_channels)
  const targets = (opts.forceChannels ?? enabled).filter((ch) =>
    ALL_NOTIFIERS.some((n) => n.channel === ch),
  )

  // De-dup: skip channels that have already received this dedup key.
  // (Cross-day window: we look at all-time, not just `date('now')`, because the
  // same `(item, current_price)` should not be re-emailed weeks later either.)
  if (opts.dedupKey && !opts.noDedup) {
    const existing = await env.DB
      .prepare(
        `SELECT channel FROM notifications_log
         WHERE user_id = ? AND dedup_key = ? AND status = 'sent'`,
      )
      .bind(user.id, opts.dedupKey)
      .all<{ channel: string }>()
    const sentChannels = new Set(existing.results.map((r) => r.channel))
    for (let i = targets.length - 1; i >= 0; i--) {
      if (sentChannels.has(targets[i]!)) targets.splice(i, 1)
    }
  }

  const results: NotifyResult[] = []
  for (const ch of targets) {
    const notifier = ALL_NOTIFIERS.find((n) => n.channel === ch)!
    const ctx = {
      user,
      payload,
      watchlistItemId: opts.watchlistItemId,
    }
    if (!notifier.isEnabled(env, ctx)) {
      results.push({ channel: ch, status: 'skipped', error: 'not_enabled' })
      continue
    }
    try {
      const res = await notifier.send(env, ctx)
      results.push(res)
    } catch (err) {
      results.push({
        channel: ch,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Persist logs
  for (const r of results) {
    await env.DB
      .prepare(
        `INSERT INTO notifications_log
           (user_id, watchlist_item_id, channel, payload, status, error, dedup_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        opts.watchlistItemId ?? null,
        r.channel,
        JSON.stringify(payload),
        r.status,
        r.error ?? null,
        opts.dedupKey ?? null,
      )
      .run()
  }
  return results
}

function parseChannels(jsonStr: string): NotificationChannel[] {
  try {
    const arr = JSON.parse(jsonStr) as NotificationChannel[]
    return Array.isArray(arr) ? arr : ['email']
  } catch {
    return ['email']
  }
}
