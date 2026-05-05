import { Hono } from 'hono'
import type { AppContext } from '../env.js'
import { claimLinkCode } from '../services/link.js'

export const webhookRouter = new Hono<AppContext>()

/**
 * LINE Messaging API webhook.
 *
 * Authenticates each request by recomputing HMAC-SHA256(channel_secret, raw_body)
 * and constant-time comparing against the `x-line-signature` header (base64).
 * Reference: https://developers.line.biz/en/reference/messaging-api/#signature-validation
 *
 * On a text message that contains exactly the link code we issued, we bind the
 * sender's `userId` onto the matching account.
 */
webhookRouter.post('/line', async (c) => {
  const env = c.env
  if (!env.LINE_CHANNEL_SECRET) {
    return c.text('webhook not configured', 503)
  }
  const signature = c.req.header('x-line-signature') ?? ''
  const rawBody = await c.req.text()
  if (!(await verifyLineSignature(env.LINE_CHANNEL_SECRET, rawBody, signature))) {
    return c.text('bad signature', 401)
  }

  let payload: LineWebhookBody
  try {
    payload = JSON.parse(rawBody) as LineWebhookBody
  } catch {
    return c.text('bad json', 400)
  }
  for (const ev of payload.events ?? []) {
    if (ev.type !== 'message' || ev.message?.type !== 'text') continue
    const text = (ev.message.text ?? '').trim().toUpperCase()
    const userId = ev.source?.userId
    if (!userId || !text) continue
    const result = await claimLinkCode(env.DB, text, 'line', userId)
    if (result.ok) {
      // Best-effort acknowledge to user (ignore errors — webhook must still 200).
      void replyLineMessage(env, ev.replyToken, '✅ 已成功連結 LINE 通知。')
    } else if (result.reason === 'unknown_code' || result.reason === 'expired') {
      void replyLineMessage(env, ev.replyToken, '❌ 連結代碼無效或已過期，請重新產生。')
    }
  }
  return c.json({ ok: true })
})

/**
 * Telegram Bot webhook.
 *
 * Authenticates each request by comparing the `x-telegram-bot-api-secret-token`
 * header against `TELEGRAM_WEBHOOK_SECRET` (which we set when registering the
 * webhook via setWebhook). Reference:
 * https://core.telegram.org/bots/api#setwebhook
 *
 * On `/start <code>` from a user we bind that chat ID onto the matching account.
 */
webhookRouter.post('/telegram', async (c) => {
  const env = c.env
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text('webhook not configured', 503)
  }
  const provided = c.req.header('x-telegram-bot-api-secret-token') ?? ''
  if (!constantTimeEqual(provided, env.TELEGRAM_WEBHOOK_SECRET)) {
    return c.text('bad secret', 401)
  }
  let update: TelegramUpdate
  try {
    update = (await c.req.json()) as TelegramUpdate
  } catch {
    // Malformed body — ack with 200 so Telegram does not retry the bad payload.
    return c.json({ ok: true })
  }
  const msg = update.message
  if (!msg?.text || !msg.from || !msg.chat) return c.json({ ok: true })

  const m = /^\/start(?:@\S+)?\s+([A-Za-z0-9]{4,64})\s*$/.exec(msg.text)
  if (!m || !m[1]) return c.json({ ok: true })

  const code = m[1]
  const chatId = String(msg.chat.id)
  const result = await claimLinkCode(env.DB, code, 'telegram', chatId)
  if (env.TELEGRAM_BOT_TOKEN) {
    void sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      result.ok
        ? '✅ 已成功連結 Telegram 通知。'
        : '❌ 連結代碼無效或已過期，請重新產生。',
    )
  }
  return c.json({ ok: true })
})

// ---------- helpers ----------

interface LineWebhookBody {
  events?: Array<{
    type: string
    replyToken?: string
    message?: { type: string; text?: string }
    source?: { userId?: string }
  }>
}

interface TelegramUpdate {
  message?: {
    text?: string
    from?: { id: number }
    chat?: { id: number }
  }
}

async function verifyLineSignature(
  secret: string,
  rawBody: string,
  providedBase64: string,
): Promise<boolean> {
  if (!providedBase64) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)),
  )
  const expected = btoa(String.fromCharCode(...sig))
  return constantTimeEqual(expected, providedBase64)
}

/**
 * Constant-time string equality. Iterates over `max(a.length, b.length)` and
 * folds the length difference into the diff so the running time does not depend
 * on which characters match. Returns false on length mismatch (correct), but
 * does the work either way to avoid leaking the length via side-channel timing.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0
    const cb = i < b.length ? b.charCodeAt(i) : 0
    diff |= ca ^ cb
  }
  return diff === 0
}

async function replyLineMessage(
  env: { LINE_CHANNEL_ACCESS_TOKEN?: string },
  replyToken: string | undefined,
  text: string,
): Promise<void> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !replyToken) return
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  }).catch(() => undefined)
}

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => undefined)
}

// Exported for unit tests.
export const __test = { verifyLineSignature, constantTimeEqual }
