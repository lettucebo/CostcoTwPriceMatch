import { Hono } from 'hono'
import type { AppContext } from '../env.js'
import { requireAuth } from '../auth/middleware.js'
import { CreateSubscriptionSchema, type SubscriptionRow } from '@costco/shared'

export const subscriptionsRouter = new Hono<AppContext>()

subscriptionsRouter.use('*', requireAuth)

subscriptionsRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB
    .prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<SubscriptionRow>()
  return c.json({ subscriptions: results })
})

subscriptionsRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const body = CreateSubscriptionSchema.parse(await c.req.json())
  await c.env.DB
    .prepare(
      `INSERT INTO subscriptions (user_id, type, product_code) VALUES (?, ?, ?)
       ON CONFLICT (user_id, type, product_code) DO NOTHING`,
    )
    .bind(userId, body.type, body.product_code ?? null)
    .run()
  return c.json({ ok: true })
})

subscriptionsRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  const id = Number(c.req.param('id'))
  await c.env.DB
    .prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  return c.json({ ok: true })
})
