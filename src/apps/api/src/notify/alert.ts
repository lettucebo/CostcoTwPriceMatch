import type { Env } from '../env.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/**
 * Send an operational alert email to ADMIN_ALERT_EMAIL when cron runs hit too
 * many errors. Best-effort: failures are logged, never thrown.
 */
export async function sendCronAlert(
  env: Env,
  subject: string,
  details: Record<string, unknown>,
): Promise<void> {
  const to = env.ADMIN_ALERT_EMAIL
  if (!to || !env.RESEND_API_KEY) {
    console.warn('[alert] cron alert suppressed (no ADMIN_ALERT_EMAIL or RESEND_API_KEY)', {
      subject,
      details,
    })
    return
  }
  const html =
    `<h2>${escapeHtml(subject)}</h2>` +
    `<pre style="background:#0f0f17;color:#fff;padding:12px;border-radius:6px;font:12px ui-monospace,monospace;white-space:pre-wrap;">` +
    escapeHtml(JSON.stringify(details, null, 2)) +
    `</pre>`
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CostcoMatch Alerts <onboarding@resend.dev>',
        to,
        subject: `[CostcoMatch] ${subject}`,
        html,
        text: `${subject}\n\n${JSON.stringify(details, null, 2)}`,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[alert] failed to send', res.status, body.slice(0, 200))
    }
  } catch (err) {
    console.error('[alert] sendCronAlert threw', err)
  }
}

/** Get the configured threshold; default 5; 0 disables. */
export function alertThreshold(env: Env): number {
  const raw = env.CRON_ALERT_THRESHOLD
  const n = raw == null ? 5 : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 5
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
