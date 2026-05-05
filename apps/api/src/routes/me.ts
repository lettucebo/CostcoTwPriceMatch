import { Hono } from 'hono'
import type { AppContext } from '../env.js'
import { requireAuth } from '../auth/middleware.js'
import {
  UpdateNotificationSettingsSchema,
  type UserRow,
} from '@costco/shared'

export const meRouter = new Hono<AppContext>()

meRouter.use('*', requireAuth)

meRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const user = await c.env.DB
    .prepare(
      `SELECT id, email, name, picture, notification_email, notification_channels,
              line_user_id IS NOT NULL AS line_linked,
              telegram_chat_id IS NOT NULL AS telegram_linked
       FROM users WHERE id = ?`,
    )
    .bind(userId)
    .first<
      UserRow & {
        line_linked: number
        telegram_linked: number
      }
    >()
  if (!user) return c.json({ error: 'not_found' }, 404)
  const channels = JSON.parse(user.notification_channels) as string[]
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    notification_email: user.notification_email,
    channels,
    line_linked: !!user.line_linked,
    telegram_linked: !!user.telegram_linked,
  })
})

meRouter.patch('/notifications', async (c) => {
  const userId = c.get('userId')
  const body = UpdateNotificationSettingsSchema.parse(await c.req.json())
  const sets: string[] = []
  const params: unknown[] = []
  if (body.notification_email !== undefined) {
    sets.push('notification_email = ?')
    params.push(body.notification_email)
  }
  if (body.channels) {
    sets.push('notification_channels = ?')
    params.push(JSON.stringify(body.channels))
  }
  sets.push("updated_at = datetime('now')")
  params.push(userId)
  if (sets.length === 1) return c.json({ ok: true })
  await c.env.DB
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run()
  return c.json({ ok: true })
})

meRouter.patch('/link/line', async (c) => {
  const userId = c.get('userId')
  const { line_user_id } = (await c.req.json()) as { line_user_id?: string | null }
  await c.env.DB
    .prepare(
      `UPDATE users SET line_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(line_user_id || null, userId)
    .run()
  return c.json({ ok: true })
})

meRouter.patch('/link/telegram', async (c) => {
  const userId = c.get('userId')
  const { telegram_chat_id } = (await c.req.json()) as {
    telegram_chat_id?: string | null
  }
  await c.env.DB
    .prepare(
      `UPDATE users SET telegram_chat_id = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(telegram_chat_id || null, userId)
    .run()
  return c.json({ ok: true })
})

meRouter.delete('/', async (c) => {
  const userId = c.get('userId')
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
  return c.json({ ok: true })
})
