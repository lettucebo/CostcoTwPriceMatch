import { describe, it, expect, beforeEach } from 'vitest'
import {
  createLinkCode,
  claimLinkCode,
  unlinkChannel,
} from '../src/services/link.js'

/** Minimal in-memory D1Database stub sufficient for the link.ts queries. */
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
        if (
          /SELECT user_id, expires_at FROM link_codes WHERE code = \? AND channel = \?/i.test(
            sql,
          )
        ) {
          const [code, channel] = params as [string, string]
          const row = linkCodes.find(
            (r) => r.code === code && r.channel === channel,
          )
          if (!row) return null
          return { user_id: row.user_id, expires_at: row.expires_at } as T
        }
        return null
      },
      async run() {
        if (
          /DELETE FROM link_codes WHERE user_id = \? AND channel = \?/i.test(sql)
        ) {
          const [uid, ch] = params as [number, string]
          for (let i = linkCodes.length - 1; i >= 0; i--) {
            if (linkCodes[i].user_id === uid && linkCodes[i].channel === ch) {
              linkCodes.splice(i, 1)
            }
          }
        } else if (
          /INSERT INTO link_codes \(code, user_id, channel, expires_at\) VALUES/i.test(
            sql,
          )
        ) {
          const [code, user_id, channel, expires_at] = params as [
            string,
            number,
            string,
            string,
          ]
          linkCodes.push({
            code,
            user_id,
            channel,
            expires_at,
            created_at: new Date().toISOString(),
          })
        } else if (/DELETE FROM link_codes WHERE code = \?/i.test(sql)) {
          const [code] = params as [string]
          const idx = linkCodes.findIndex((r) => r.code === code)
          if (idx >= 0) linkCodes.splice(idx, 1)
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
          /DELETE FROM link_codes WHERE expires_at < datetime\('now'\)/i.test(sql)
        ) {
          const now = Date.now()
          let removed = 0
          for (let i = linkCodes.length - 1; i >= 0; i--) {
            if (Date.parse(linkCodes[i].expires_at) < now) {
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
      return {
        bind: (...params: unknown[]) => bind(sql, params),
      }
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      const out = []
      for (const s of stmts) out.push(await s.run())
      return out
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

  it('rejects expired codes and cleans them up', async () => {
    const link = await createLinkCode(db, 1, 'line')
    // Forcibly expire it.
    db._linkCodes[0].expires_at = new Date(Date.now() - 1000).toISOString()
    const result = await claimLinkCode(db, link.code, 'line', 'U-x')
    expect(result.ok).toBe(false)
    expect(db._linkCodes).toHaveLength(0)
  })

  it('cannot reuse a claimed code', async () => {
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

  it('issuing a new code wipes the previous one', async () => {
    const a = await createLinkCode(db, 1, 'line')
    const b = await createLinkCode(db, 1, 'line')
    expect(a.code).not.toBe(b.code)
    expect(db._linkCodes).toHaveLength(1)
    expect(db._linkCodes[0].code).toBe(b.code)
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
})
