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
  /** Tag this notification to a watchlist item for de-dup. */
  watchlistItemId?: number
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

  // De-dup: skip if same (watchlistItemId, channel, payload-key) already sent.
  if (opts.watchlistItemId && !opts.noDedup) {
    const key = dedupKey(payload)
    const existing = await env.DB
      .prepare(
        `SELECT channel FROM notifications_log
         WHERE user_id = ? AND watchlist_item_id = ?
           AND status = 'sent' AND json_extract(payload, '$._dedup') = ?`,
      )
      .bind(user.id, opts.watchlistItemId, key)
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

  // Persist logs (with internal _dedup marker)
  for (const r of results) {
    const payloadWithDedup = { ...payload, _dedup: dedupKey(payload) }
    await env.DB
      .prepare(
        `INSERT INTO notifications_log
           (user_id, watchlist_item_id, channel, payload, status, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        opts.watchlistItemId ?? null,
        r.channel,
        JSON.stringify(payloadWithDedup),
        r.status,
        r.error ?? null,
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

function dedupKey(p: NotifyPayload): string {
  // Same kind + same items signature => same notification
  const sig = (p.items ?? [])
    .map((i) => `${i.code}@${i.current_price}`)
    .sort()
    .join('|')
  return `${p.kind}:${sig}`
}
