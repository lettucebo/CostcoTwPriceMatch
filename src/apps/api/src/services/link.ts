import type { D1Database } from '@cloudflare/workers-types'

const CODE_TTL_SEC = 60 * 10 // 10 minutes
const LINE_CODE_LEN = 6 // "LINE-XXXXXX"
const TELEGRAM_CODE_LEN = 16 // hex; goes into the start_param

export type LinkChannel = 'line' | 'telegram'

export interface LinkCode {
  code: string
  user_id: number
  channel: LinkChannel
  expires_at: string
}

/** Cryptographically random hex string of given length. */
function randomHex(len: number): string {
  const bytes = new Uint8Array(Math.ceil(len / 2))
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, len)
}

/** Generate human-readable code for LINE (uppercase, easy to type). */
function randomBase32(len: number): string {
  // Avoid ambiguous chars 0/O, 1/I/L
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) {
    const byte = bytes[i] as number
    out += alphabet[byte % alphabet.length]
  }
  return out
}

/**
 * Create a fresh link code for the given user/channel.
 * Replaces any prior unclaimed code for the same (user, channel) so users can re-issue.
 */
export async function createLinkCode(
  db: D1Database,
  userId: number,
  channel: LinkChannel,
): Promise<LinkCode> {
  const code =
    channel === 'line'
      ? randomBase32(LINE_CODE_LEN)
      : randomHex(TELEGRAM_CODE_LEN)
  const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString()

  // Wipe any prior pending code for this user+channel so only the latest works.
  await db
    .prepare('DELETE FROM link_codes WHERE user_id = ? AND channel = ?')
    .bind(userId, channel)
    .run()

  await db
    .prepare(
      'INSERT INTO link_codes (code, user_id, channel, expires_at) VALUES (?, ?, ?, ?)',
    )
    .bind(code, userId, channel, expiresAt)
    .run()

  return { code, user_id: userId, channel, expires_at: expiresAt }
}

/**
 * Atomically consume a link code (if valid + unexpired) and bind the external id
 * onto the owning user. Returns true on success, false if the code is unknown,
 * expired, or for the wrong channel.
 *
 * Called from webhook handlers after the request signature has been verified.
 */
export async function claimLinkCode(
  db: D1Database,
  code: string,
  channel: LinkChannel,
  externalId: string,
): Promise<{ ok: true; user_id: number } | { ok: false; reason: string }> {
  const row = await db
    .prepare(
      `SELECT user_id, expires_at FROM link_codes WHERE code = ? AND channel = ?`,
    )
    .bind(code, channel)
    .first<{ user_id: number; expires_at: string }>()
  if (!row) return { ok: false, reason: 'unknown_code' }
  if (Date.parse(row.expires_at) < Date.now()) {
    await db.prepare('DELETE FROM link_codes WHERE code = ?').bind(code).run()
    return { ok: false, reason: 'expired' }
  }

  const column = channel === 'line' ? 'line_user_id' : 'telegram_chat_id'
  // Update + delete in a single batch so the code cannot be claimed twice.
  await db.batch([
    db
      .prepare(
        `UPDATE users SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .bind(externalId, row.user_id),
    db.prepare('DELETE FROM link_codes WHERE code = ?').bind(code),
  ])
  return { ok: true, user_id: row.user_id }
}

/** Remove the binding for a channel on a user. */
export async function unlinkChannel(
  db: D1Database,
  userId: number,
  channel: LinkChannel,
): Promise<void> {
  const column = channel === 'line' ? 'line_user_id' : 'telegram_chat_id'
  await db
    .prepare(
      `UPDATE users SET ${column} = NULL, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(userId)
    .run()
  await db
    .prepare('DELETE FROM link_codes WHERE user_id = ? AND channel = ?')
    .bind(userId, channel)
    .run()
}

/** Sweep expired codes (call from cron occasionally; not critical). */
export async function purgeExpiredLinkCodes(db: D1Database): Promise<number> {
  const res = await db
    .prepare("DELETE FROM link_codes WHERE expires_at < datetime('now')")
    .run()
  return res.meta.changes ?? 0
}
