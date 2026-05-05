import { describe, it, expect, beforeEach } from 'vitest'
import {
  createLinkCode,
  claimLinkCode,
  revokePendingCode,
  unlinkChannel,
  purgeExpiredLinkCodes,
} from '../src/services/link.js'

/**
 * Minimal in-memory D1Database stub sufficient for the link.ts queries.
 * Mirrors the SQL the service emits — when a query in `link.ts` changes the
 * matching regex here must change too.
 */
function makeDb() {
  const linkCodes: Array<{
    code: string
    user_id: number
    channel: string
    expires_at: string
    created_at: string
  }> = []
  const users = new Map<
    number,
    { id: number; line_user_id: string | null; telegram_chat_id: string | null }
  >()

  function bind(sql: string, params: unknown[]) {
    return {
      async first<T>(): Promise<T | null> {
        // Atomic claim: DELETE ... RETURNING
        if (
          /DELETE FROM link_codes\s+WHERE code = \? AND channel = \?\s+AND julianday\(expires_at\) >= julianday\('now'\)\s+RETURNING user_id/is.test(
            sql,
          )
        ) {
          const [code, channel] = params as [string, string]
          const idx = linkCodes.findIndex(
            (r) => r.code === code && r.channel === channel,
          )
          if (idx < 0) return null
          if (Date.parse(linkCodes[idx]!.expires_at) < Date.now()) {
            // Expired: SQLite would not return the row but would also not
            // delete it (julianday filter excludes it). Mimic that: no delete.
            return null
          }
          const row = linkCodes[idx]!
          linkCodes.splice(idx, 1)
          return { user_id: row.user_id } as T
        }
        return null
      },
      async run() {
        // Upsert via ON CONFLICT(user_id, channel)
        if (
          /INSERT INTO link_codes \(code, user_id, channel, expires_at\)\s+VALUES \(\?, \?, \?, \?\)\s+ON CONFLICT\(user_id, channel\) DO UPDATE/is.test(
            sql,
          )
        ) {
          const [code, user_id, channel, expires_at] = params as [
            string,
            number,
            string,
            string,
          ]
          const existing = linkCodes.find(
            (r) => r.user_id === user_id && r.channel === channel,
          )
          if (existing) {
            existing.code = code
            existing.expires_at = expires_at
            existing.created_at = new Date().toISOString()
          } else {
            linkCodes.push({
              code,
              user_id,
              channel,
              expires_at,
              created_at: new Date().toISOString(),
            })
          }
          return { meta: { changes: 1 } }
        }
        if (
          /DELETE FROM link_codes WHERE user_id = \? AND channel = \?/i.test(sql)
        ) {
          const [uid, ch] = params as [number, string]
          for (let i = linkCodes.length - 1; i >= 0; i--) {
            if (linkCodes[i]!.user_id === uid && linkCodes[i]!.channel === ch) {
              linkCodes.splice(i, 1)
            }
          }
        } else if (
          /UPDATE users SET line_user_id = NULL,/i.test(sql)
        ) {
          const [uid] = params as [number]
          const u = users.get(uid)
          if (u) u.line_user_id = null
        } else if (
          /UPDATE users SET telegram_chat_id = NULL,/i.test(sql)
        ) {
          const [uid] = params as [number]
          const u = users.get(uid)
          if (u) u.telegram_chat_id = null
        } else if (
          /UPDATE users SET line_user_id = \?,/i.test(sql)
        ) {
          const [val, uid] = params as [string | null, number]
          const u = users.get(uid)
          if (u) u.line_user_id = val
        } else if (
          /UPDATE users SET telegram_chat_id = \?,/i.test(sql)
        ) {
          const [val, uid] = params as [string | null, number]
          const u = users.get(uid)
          if (u) u.telegram_chat_id = val
        } else if (
          /DELETE FROM link_codes WHERE julianday\(expires_at\) < julianday\('now'\)/i.test(
            sql,
          )
        ) {
          const now = Date.now()
          let removed = 0
          for (let i = linkCodes.length - 1; i >= 0; i--) {
            if (Date.parse(linkCodes[i]!.expires_at) < now) {
              linkCodes.splice(i, 1)
              removed++
            }
          }
          return { meta: { changes: removed } }
        }
        return { meta: { changes: 0 } }
      },
    }
  }

  return {
    _users: users,
    _linkCodes: linkCodes,
    prepare(sql: string) {
      const noParams = bind(sql, [])
      return {
        bind: (...params: unknown[]) => bind(sql, params),
        // Direct .run() / .first() for parameterless statements.
        run: noParams.run,
        first: noParams.first,
      }
    },
  }
}

describe('link service', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any

  beforeEach(() => {
    db = makeDb()
    db._users.set(1, { id: 1, line_user_id: null, telegram_chat_id: null })
    db._users.set(2, { id: 2, line_user_id: null, telegram_chat_id: null })
  })

  it('createLinkCode returns a code that can be claimed', async () => {
    const link = await createLinkCode(db, 1, 'line')
    expect(link.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(link.user_id).toBe(1)

    const result = await claimLinkCode(db, link.code, 'line', 'U-abc-123')
    expect(result.ok).toBe(true)
    expect(db._users.get(1).line_user_id).toBe('U-abc-123')
  })

  it('rejects unknown codes', async () => {
    const result = await claimLinkCode(db, 'NOPE99', 'line', 'U-x')
    expect(result.ok).toBe(false)
    expect(db._users.get(1).line_user_id).toBeNull()
  })

  it('rejects expired codes (atomic delete excludes them)', async () => {
    const link = await createLinkCode(db, 1, 'line')
    db._linkCodes[0].expires_at = new Date(Date.now() - 1000).toISOString()
    const result = await claimLinkCode(db, link.code, 'line', 'U-x')
    expect(result.ok).toBe(false)
    // Row remains for purgeExpiredLinkCodes to sweep — claim is a no-op.
    expect(db._linkCodes).toHaveLength(1)
  })

  it('cannot reuse a claimed code (atomic single-winner)', async () => {
    const link = await createLinkCode(db, 1, 'line')
    const r1 = await claimLinkCode(db, link.code, 'line', 'U-1')
    const r2 = await claimLinkCode(db, link.code, 'line', 'U-2')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(false)
    expect(db._users.get(1).line_user_id).toBe('U-1')
  })

  it('rejects channel mismatch', async () => {
    const link = await createLinkCode(db, 1, 'line')
    const r = await claimLinkCode(db, link.code, 'telegram', '12345')
    expect(r.ok).toBe(false)
  })

  it('issuing a new code replaces the previous one (UNIQUE user_id+channel)', async () => {
    const a = await createLinkCode(db, 1, 'line')
    const b = await createLinkCode(db, 1, 'line')
    expect(a.code).not.toBe(b.code)
    expect(db._linkCodes).toHaveLength(1)
    expect(db._linkCodes[0].code).toBe(b.code)
    const r = await claimLinkCode(db, a.code, 'line', 'U-x')
    expect(r.ok).toBe(false)
  })

  it('telegram codes use 16-char hex', async () => {
    const link = await createLinkCode(db, 1, 'telegram')
    expect(link.code).toMatch(/^[0-9a-f]{16}$/)
  })

  it('unlinkChannel clears the column and pending codes', async () => {
    db._users.get(1).line_user_id = 'U-old'
    await createLinkCode(db, 1, 'line')
    await unlinkChannel(db, 1, 'line')
    expect(db._users.get(1).line_user_id).toBeNull()
    expect(db._linkCodes).toHaveLength(0)
  })

  it('revokePendingCode removes only the pending code, not the binding', async () => {
    db._users.get(1).line_user_id = 'U-still-bound'
    await createLinkCode(db, 1, 'line')
    expect(db._linkCodes).toHaveLength(1)
    await revokePendingCode(db, 1, 'line')
    expect(db._linkCodes).toHaveLength(0)
    expect(db._users.get(1).line_user_id).toBe('U-still-bound')
  })

  it('purgeExpiredLinkCodes deletes only expired rows (julianday compare)', async () => {
    await createLinkCode(db, 1, 'line') // future
    db._linkCodes.push({
      code: 'OLD000',
      user_id: 2,
      channel: 'line',
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    })
    const removed = await purgeExpiredLinkCodes(db)
    expect(removed).toBe(1)
    expect(db._linkCodes).toHaveLength(1)
    expect(db._linkCodes[0].code).not.toBe('OLD000')
  })

  it('isolates pending codes per (user, channel)', async () => {
    await createLinkCode(db, 1, 'line')
    await createLinkCode(db, 1, 'telegram')
    await createLinkCode(db, 2, 'line')
    expect(db._linkCodes).toHaveLength(3)
  })
})
