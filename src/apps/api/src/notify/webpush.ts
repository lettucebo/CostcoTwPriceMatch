import type { Notifier, NotifyResult } from './notifier.js'
import {
  sendPush,
  PushSendError,
  type VapidConfig,
  type PushSubscriptionKeys,
} from './webpush-protocol.js'

interface PushSubRow {
  id: number
  endpoint: string
  p256dh: string
  auth: string
}

export const webpushNotifier: Notifier = {
  channel: 'webpush',
  isEnabled(env, ctx) {
    // Cheap check; the dispatch loop will count 0 sends if user has no subs.
    return (
      !!env.VAPID_PUBLIC_KEY &&
      !!env.VAPID_PRIVATE_KEY &&
      !!env.VAPID_SUBJECT &&
      !!ctx.user.id
    )
  },
  async send(env, ctx): Promise<NotifyResult> {
    const vapid: VapidConfig = {
      publicKey: env.VAPID_PUBLIC_KEY!,
      privateKey: env.VAPID_PRIVATE_KEY!,
      subject: env.VAPID_SUBJECT!,
    }

    const { results: subs } = await env.DB
      .prepare(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
      )
      .bind(ctx.user.id)
      .all<PushSubRow>()

    if (subs.length === 0) {
      return { channel: 'webpush', status: 'skipped', error: 'no_subscriptions' }
    }

    // Compact payload — push providers cap around 4KB.
    const payload = JSON.stringify({
      title: ctx.payload.title,
      body: ctx.payload.body,
      url: ctx.payload.url,
      // Keep one item teaser
      item: ctx.payload.items?.[0],
    })

    let sent = 0
    let failed = 0
    let lastError: string | undefined

    for (const s of subs) {
      const sub: PushSubscriptionKeys = {
        endpoint: s.endpoint,
        p256dh: s.p256dh,
        auth: s.auth,
      }
      try {
        await sendPush(sub, payload, vapid, { ttl: 86400, urgency: 'normal' })
        sent++
      } catch (err) {
        failed++
        if (err instanceof PushSendError && (err.status === 410 || err.status === 404)) {
          // Subscription gone — clean up
          await env.DB
            .prepare('DELETE FROM push_subscriptions WHERE id = ?')
            .bind(s.id)
            .run()
        }
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    if (sent > 0) return { channel: 'webpush', status: 'sent' }
    return { channel: 'webpush', status: 'failed', error: lastError }
  },
}
