import type { D1Database } from '@cloudflare/workers-types'

const CODE_TTL_SEC = 60 * 10 // 10 minutes
const LINE_CODE_LEN = 6 // 6 base32-style chars (no prefix); user types this into the LINE bot
const TELEGRAM_CODE_LEN = 16 // hex; embedded in the t.me/<bot>?start=<code> deep link

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
 * Create or refresh the pending link code for the given (user, channel).
 *
 * Uses `INSERT ... ON CONFLICT(user_id, channel) DO UPDATE` so the DB enforces the
 * "one active code per (user, channel)" invariant atomically — concurrent retries
 * cannot leave more than one pending row, and the prior code is invalidated.
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

  await db
    .prepare(
      `INSERT INTO link_codes (code, user_id, channel, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, channel) DO UPDATE SET
         code = excluded.code,
         expires_at = excluded.expires_at,
         created_at = datetime('now')`,
    )
    .bind(code, userId, channel, expiresAt)
    .run()

  return { code, user_id: userId, channel, expires_at: expiresAt }
}

/**
 * Atomically consume a link code (if valid + unexpired) and bind the external id
 * onto the owning user. Returns true on success; false if the code is unknown,
 * for the wrong channel, or expired.
 *
 * The consume step is a single `DELETE ... RETURNING` so two concurrent webhook
 * invocations cannot both succeed: only the connection that wins the row delete
 * proceeds to update the user. `julianday(...)` is used for the expiry check so
 * the comparison works regardless of `expires_at` storage format (ISO 8601 vs
 * SQLite `datetime()` text).
 */
export async function claimLinkCode(
  db: D1Database,
  code: string,
  channel: LinkChannel,
  externalId: string,
): Promise<{ ok: true; user_id: number } | { ok: false; reason: string }> {
  const row = await db
    .prepare(
      `DELETE FROM link_codes
       WHERE code = ? AND channel = ?
         AND julianday(expires_at) >= julianday('now')
       RETURNING user_id`,
    )
    .bind(code, channel)
    .first<{ user_id: number }>()
  if (!row) return { ok: false, reason: 'invalid_or_expired' }

  const column = channel === 'line' ? 'line_user_id' : 'telegram_chat_id'
  await db
    .prepare(
      `UPDATE users SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(externalId, row.user_id)
    .run()
  return { ok: true, user_id: row.user_id }
}

/** Remove the pending code (if any) for this (user, channel) without unlinking. */
export async function revokePendingCode(
  db: D1Database,
  userId: number,
  channel: LinkChannel,
): Promise<void> {
  await db
    .prepare('DELETE FROM link_codes WHERE user_id = ? AND channel = ?')
    .bind(userId, channel)
    .run()
}

/** Remove the binding for a channel on a user. Also clears any pending codes. */
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
  // julianday() parses both ISO 8601 ("2026-05-05T16:10:00.000Z") and SQLite
  // datetime() output ("2026-05-05 16:10:00"), so this works regardless of the
  // string format chosen at INSERT time.
  const res = await db
    .prepare(
      "DELETE FROM link_codes WHERE julianday(expires_at) < julianday('now')",
    )
    .run()
  return res.meta.changes ?? 0
}
