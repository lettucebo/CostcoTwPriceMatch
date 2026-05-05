import type { Notifier, NotifyResult } from './notifier.js'

export const telegramNotifier: Notifier = {
  channel: 'telegram',
  isEnabled(env, ctx) {
    return !!env.TELEGRAM_BOT_TOKEN && !!ctx.user.telegram_chat_id
  },
  async send(env, ctx): Promise<NotifyResult> {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return { channel: 'telegram', status: 'skipped', error: 'no_token' }
    }
    if (!ctx.user.telegram_chat_id) {
      return { channel: 'telegram', status: 'skipped', error: 'not_linked' }
    }
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ctx.user.telegram_chat_id,
        text: renderMarkdown(ctx.payload),
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        channel: 'telegram',
        status: 'failed',
        error: `${res.status}: ${body.slice(0, 200)}`,
      }
    }
    return { channel: 'telegram', status: 'sent' }
  },
}

function renderMarkdown(p: import('@costco/shared').NotifyPayload): string {
  const lines: string[] = [`*${escape(p.title)}*`, '', escape(p.body)]
  if (p.items?.length) {
    lines.push('')
    for (const it of p.items.slice(0, 10)) {
      const parts = [`• \`#${it.code}\` *${escape(it.name)}*`]
      if (it.purchase_price != null) parts.push(`買 $${it.purchase_price}`)
      parts.push(`目前 $${it.current_price}`)
      if (it.diff != null && it.diff > 0) parts.push(`差價 $${it.diff}`)
      if (it.days_remaining != null)
        parts.push(`剩 ${Math.max(0, it.days_remaining)} 天`)
      lines.push(parts.join(' · '))
    }
  }
  if (p.url) lines.push('', `[查看追蹤清單](${p.url})`)
  return lines.join('\n')
}

function escape(s: string): string {
  // Telegram Markdown legacy: escape *_`[
  return s.replace(/([_*`\[\]])/g, '\\$1')
}
