import type { Notifier, NotifyResult } from './notifier.js'

const ENDPOINT = 'https://api.line.me/v2/bot/message/push'

export const lineNotifier: Notifier = {
  channel: 'line',
  isEnabled(env, ctx) {
    return !!env.LINE_CHANNEL_ACCESS_TOKEN && !!ctx.user.line_user_id
  },
  async send(env, ctx): Promise<NotifyResult> {
    if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
      return { channel: 'line', status: 'skipped', error: 'no_token' }
    }
    if (!ctx.user.line_user_id) {
      return { channel: 'line', status: 'skipped', error: 'not_linked' }
    }

    const messages = renderLineMessages(ctx.payload)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: ctx.user.line_user_id,
        messages,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        channel: 'line',
        status: 'failed',
        error: `${res.status}: ${body.slice(0, 200)}`,
      }
    }
    return { channel: 'line', status: 'sent' }
  },
}

function renderLineMessages(p: import('@costco/shared').NotifyPayload) {
  // LINE allows up to 5 messages per push; we send 1 text + (optionally) a flex card.
  const text = renderText(p)
  if (!p.items?.length) {
    return [{ type: 'text', text }]
  }
  // Build a simple Flex carousel of items (max 10).
  const bubbles = p.items.slice(0, 10).map((it) => ({
    type: 'bubble',
    size: 'kilo',
    hero: it.image_url
      ? {
          type: 'image',
          url: it.image_url,
          size: 'full',
          aspectRatio: '1:1',
          aspectMode: 'cover',
        }
      : undefined,
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: `#${it.code}`,
          size: 'xs',
          color: '#999999',
        },
        {
          type: 'text',
          text: it.name,
          weight: 'bold',
          size: 'sm',
          wrap: true,
          maxLines: 2,
        },
        {
          type: 'box',
          layout: 'baseline',
          margin: 'md',
          contents: [
            ...(it.purchase_price != null
              ? [
                  {
                    type: 'text',
                    text: `買 $${it.purchase_price}`,
                    size: 'xs',
                    color: '#999999',
                  },
                  { type: 'text', text: ' → ', size: 'xs', flex: 0 },
                ]
              : []),
            {
              type: 'text',
              text: `$${it.current_price}`,
              size: 'sm',
              weight: 'bold',
              color: '#facc15',
            },
          ],
        },
        ...(it.diff != null && it.diff > 0
          ? [
              {
                type: 'text',
                text: `可退差價 $${it.diff}${it.days_remaining != null ? ` · 剩 ${Math.max(0, it.days_remaining)} 天` : ''}`,
                size: 'xs',
                color: '#22c55e',
                margin: 'sm',
              },
            ]
          : []),
      ],
    },
  }))
  return [
    { type: 'text', text: p.title },
    {
      type: 'flex',
      altText: p.title,
      contents:
        bubbles.length === 1
          ? bubbles[0]
          : { type: 'carousel', contents: bubbles },
    },
  ]
}

function renderText(p: import('@costco/shared').NotifyPayload): string {
  const lines = [p.title, '', p.body]
  if (p.url) lines.push(p.url)
  return lines.join('\n')
}
