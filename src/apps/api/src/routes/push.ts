import { Hono } from 'hono'
import type { AppContext } from '../env.js'
import { requireAuth } from '../auth/middleware.js'
import { PushSubscribeSchema } from '@costco/shared'

export const pushRouter = new Hono<AppContext>()

pushRouter.get('/vapid-public-key', (c) => {
  const key = c.env.VAPID_PUBLIC_KEY
  if (!key) return c.json({ error: 'web_push_disabled' }, 503)
  return c.json({ key })
})

pushRouter.use('/subscribe', requireAuth)
pushRouter.post('/subscribe', async (c) => {
  const userId = c.get('userId')
  const body = PushSubscribeSchema.parse(await c.req.json())
  await c.env.DB
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
    )
    .bind(userId, body.endpoint, body.keys.p256dh, body.keys.auth)
    .run()
  return c.json({ ok: true })
})

pushRouter.use('/unsubscribe', requireAuth)
pushRouter.post('/unsubscribe', async (c) => {
  const userId = c.get('userId')
  const { endpoint } = await c.req.json<{ endpoint: string }>()
  await c.env.DB
    .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .bind(userId, endpoint)
    .run()
  return c.json({ ok: true })
})
