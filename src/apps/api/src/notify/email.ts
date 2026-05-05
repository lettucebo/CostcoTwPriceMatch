import type { Env } from '../env.js'
import type { Notifier, NotifierContext, NotifyResult } from './notifier.js'

const ENDPOINT = 'https://api.resend.com/emails'

export const emailNotifier: Notifier = {
  channel: 'email',
  isEnabled(env, ctx) {
    return !!env.RESEND_API_KEY && !!ctx.user.notification_email
  },
  async send(env, ctx): Promise<NotifyResult> {
    if (!env.RESEND_API_KEY) {
      return { channel: 'email', status: 'skipped', error: 'no_api_key' }
    }
    const to = ctx.user.notification_email ?? ctx.user.email
    if (!to) {
      return { channel: 'email', status: 'skipped', error: 'no_address' }
    }
    const html = renderHtml(ctx.payload)
    const text = renderText(ctx.payload)
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CostcoMatch <onboarding@resend.dev>',
        to,
        subject: ctx.payload.title,
        text,
        html,
      }),
    })
    if (!res.ok) {
      const body = await safeText(res)
      return {
        channel: 'email',
        status: 'failed',
        error: `${res.status}: ${body.slice(0, 200)}`,
      }
    }
    return { channel: 'email', status: 'sent' }
  },
}

function renderText(p: import('@costco/shared').NotifyPayload): string {
  const lines: string[] = [p.title, '', p.body]
  if (p.items?.length) {
    lines.push('')
    for (const it of p.items) {
      const parts = [`#${it.code} ${it.name}`]
      if (it.purchase_price != null) parts.push(`買入 $${it.purchase_price}`)
      parts.push(`目前 $${it.current_price}`)
      if (it.diff != null && it.diff > 0) parts.push(`差價 $${it.diff}`)
      if (it.days_remaining != null)
        parts.push(`剩 ${Math.max(0, it.days_remaining)} 天`)
      lines.push('• ' + parts.join(' · '))
    }
  }
  if (p.url) lines.push('', p.url)
  return lines.join('\n')
}

function renderHtml(p: import('@costco/shared').NotifyPayload): string {
  const itemsHtml = p.items?.length
    ? `<ul style="padding:0;list-style:none;margin:16px 0">${p.items
        .map((it) => {
          const img = it.image_url
            ? `<img src="${escape(it.image_url)}" alt="" style="width:64px;height:64px;border-radius:8px;object-fit:cover;margin-right:12px;vertical-align:middle">`
            : ''
          const meta: string[] = []
          if (it.purchase_price != null) meta.push(`買入 <b>$${it.purchase_price}</b>`)
          meta.push(`目前 <b>$${it.current_price}</b>`)
          if (it.diff != null && it.diff > 0)
            meta.push(`<span style="color:#15803d">可退差價 <b>$${it.diff}</b></span>`)
          if (it.days_remaining != null)
            meta.push(`剩 <b>${Math.max(0, it.days_remaining)}</b> 天`)
          return `<li style="margin-bottom:12px;padding:12px;background:#f7f7f8;border-radius:8px">
            ${img}
            <div style="display:inline-block;vertical-align:middle">
              <div style="font-weight:600">#${escape(it.code)} ${escape(it.name)}</div>
              <div style="color:#555;font-size:13px;margin-top:4px">${meta.join(' · ')}</div>
            </div>
          </li>`
        })
        .join('')}</ul>`
    : ''
  const cta = p.url
    ? `<p><a href="${escape(p.url)}" style="display:inline-block;background:#1a1a2e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">查看追蹤清單 →</a></p>`
    : ''
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a2e">
    <h2 style="margin-top:0">${escape(p.title)}</h2>
    <p style="color:#444">${escape(p.body)}</p>
    ${itemsHtml}
    ${cta}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="font-size:12px;color:#888">CostcoMatch · 個人用 · 想退訂可至設定頁關閉 Email 通知</p>
  </div>`
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
