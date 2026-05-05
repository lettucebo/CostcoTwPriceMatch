import { Hono } from 'hono'
import type { AppContext } from '../env.js'
import { requireAuth } from '../auth/middleware.js'
import {
  UpdateNotificationSettingsSchema,
  type UserRow,
} from '@costco/shared'
import {
  createLinkCode,
  revokePendingCode,
  unlinkChannel,
} from '../services/link.js'

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

/**
 * Begin LINE link flow: server issues a one-time code; the user must send that
 * code to the LINE bot, whose webhook verifies the message signature and
 * atomically claims the code (`POST /webhook/line`).
 *
 * NOTE: The previous implementation accepted a client-supplied `line_user_id`
 * directly, which was an account-hijack-via-notification-target primitive. See #21.
 */
meRouter.post('/link/line/start', async (c) => {
  const userId = c.get('userId')
  const link = await createLinkCode(c.env.DB, userId, 'line')
  return c.json({
    code: link.code,
    expires_at: link.expires_at,
    instructions:
      '請將此代碼當作純文字訊息傳送給已加入好友的 LINE Bot，連結即會自動完成。',
  })
})

/** Tear down LINE binding. */
meRouter.delete('/link/line', async (c) => {
  const userId = c.get('userId')
  await unlinkChannel(c.env.DB, userId, 'line')
  return c.json({ ok: true })
})

/**
 * Cancel a pending LINE link code (the user clicked "取消" or believes the code
 * was exposed). Idempotent: 204-equivalent if no pending code exists.
 */
meRouter.delete('/link/line/start', async (c) => {
  const userId = c.get('userId')
  await revokePendingCode(c.env.DB, userId, 'line')
  return c.json({ ok: true })
})

/**
 * Begin Telegram link flow: returns a `t.me/<bot>?start=<code>` deep link.
 * When the user clicks it, Telegram delivers `/start <code>` to our webhook,
 * which authenticates via the secret-token header and atomically binds the chat.
 */
meRouter.post('/link/telegram/start', async (c) => {
  const userId = c.get('userId')
  const link = await createLinkCode(c.env.DB, userId, 'telegram')
  const bot = c.env.TELEGRAM_BOT_USERNAME
  const deepLink = bot ? `https://t.me/${bot}?start=${link.code}` : null
  return c.json({
    code: link.code,
    expires_at: link.expires_at,
    deep_link: deepLink,
    instructions: deepLink
      ? '點擊下方連結，於 Telegram 中按「Start」即可完成連結。'
      : '請向您的 Telegram Bot 傳送 `/start ' + link.code + '` 完成連結。',
  })
})

/** Tear down Telegram binding. */
meRouter.delete('/link/telegram', async (c) => {
  const userId = c.get('userId')
  await unlinkChannel(c.env.DB, userId, 'telegram')
  return c.json({ ok: true })
})

/** Cancel a pending Telegram link code. Same semantics as LINE. */
meRouter.delete('/link/telegram/start', async (c) => {
  const userId = c.get('userId')
  await revokePendingCode(c.env.DB, userId, 'telegram')
  return c.json({ ok: true })
})

meRouter.delete('/', async (c) => {
  const userId = c.get('userId')
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
  return c.json({ ok: true })
})
