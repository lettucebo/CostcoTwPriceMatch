import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock dispatch BEFORE importing price-match. Returns one 'sent' result per
// channel listed in the user record so the service believes notification
// succeeded; the actual notifier code does not run.
vi.mock('../src/notify/dispatch.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: vi.fn(async (env: any, user: any, payload: unknown, opts: any = {}) => {
    const channels = JSON.parse(user.notification_channels) as string[]
    for (const ch of channels) {
      await env.DB
        .prepare(
          `INSERT INTO notifications_log
             (user_id, watchlist_item_id, channel, payload, status, error, dedup_key)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          user.id,
          opts.watchlistItemId ?? null,
          ch,
          JSON.stringify(payload),
          'sent',
          null,
          opts.dedupKey ?? null,
        )
        .run()
    }
    return channels.map((ch) => ({ channel: ch, status: 'sent' as const }))
  }),
}))

import { runPriceMatch } from '../src/services/price-match.js'

/**
 * Regression test for the dedup logic fixed in #43 review:
 * a digest with N items must persist N dedup-key rows so future cron runs
 * recognize items 2..N as already sent (not just item 0).
 */

interface Row {
  [k: string]: unknown
}

function makeDb() {
  const tables = {
    users: [] as Row[],
    products: [] as Row[],
    watchlist_items: [] as Row[],
    notifications_log: [] as Row[],
  }

  function bind(sql: string, params: unknown[]) {
    const norm = sql.replace(/\s+/g, ' ').trim()
    return {
      async first<T>(): Promise<T | null> {
        if (/^SELECT \* FROM users WHERE id = \?/i.test(norm)) {
          const u = tables.users.find((r) => r.id === params[0])
          return (u ?? null) as T | null
        }
        return null
      },
      async all<T>(): Promise<{ results: T[]; meta: { changes?: number } }> {
        if (
          /^SELECT w\.id, w\.user_id, w\.product_code, w\.purchase_price/i.test(
            norm,
          )
        ) {
          const rows = tables.watchlist_items
            .filter(
              (w) =>
                ['active', 'price_match_eligible'].includes(w.status as string),
            )
            .map((w) => {
              const p = tables.products.find((p) => p.code === w.product_code)
              return p && (p.current_price as number) < (w.purchase_price as number)
                ? { ...w, ...p, code: undefined, zh_name: p.zh_name }
                : null
            })
            .filter((x): x is Row => x !== null)
          return { results: rows as T[], meta: {} }
        }
        if (
          /^SELECT DISTINCT dedup_key FROM notifications_log/i.test(norm)
        ) {
          const [userId, ...keys] = params as [number, ...string[]]
          const matched = tables.notifications_log.filter(
            (r) =>
              r.user_id === userId &&
              r.status === 'sent' &&
              keys.includes(r.dedup_key as string),
          )
          const seen = new Set<string>()
          const out: Row[] = []
          for (const r of matched) {
            if (!seen.has(r.dedup_key as string)) {
              seen.add(r.dedup_key as string)
              out.push({ dedup_key: r.dedup_key })
            }
          }
          return { results: out as T[], meta: {} }
        }
        return { results: [] as T[], meta: {} }
      },
      async run(): Promise<{ meta: { changes?: number } }> {
        if (/^UPDATE watchlist_items SET status = 'expired'/i.test(norm)) {
          // Nothing — tests use recent purchase_dates so no expiry.
          return { meta: { changes: 0 } }
        }
        if (
          /^UPDATE watchlist_items SET status = 'price_match_eligible'/i.test(
            norm,
          )
        ) {
          return { meta: { changes: 0 } }
        }
        if (/^INSERT INTO notifications_log/i.test(norm)) {
          // Two flavours: dispatch's full insert (7 params) and price-match's
          // marker insert (4 params with literal 'sent' / '{}' in SQL).
          if (params.length === 7) {
            tables.notifications_log.push({
              user_id: params[0],
              watchlist_item_id: params[1],
              channel: params[2],
              payload: params[3],
              status: params[4],
              error: params[5],
              dedup_key: params[6],
            })
          } else {
            // marker insert: VALUES (?, ?, ?, '{}', 'sent', NULL, ?)
            tables.notifications_log.push({
              user_id: params[0],
              watchlist_item_id: params[1],
              channel: params[2],
              payload: '{}',
              status: 'sent',
              error: null,
              dedup_key: params[3],
            })
          }
          return { meta: { changes: 1 } }
        }
        return { meta: { changes: 0 } }
      },
    }
  }

  return {
    _t: tables,
    prepare(sql: string) {
      const noParams = bind(sql, [])
      return {
        bind: (...params: unknown[]) => bind(sql, params),
        run: noParams.run,
        first: noParams.first,
        all: noParams.all,
      }
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      const out = []
      for (const s of stmts) out.push(await s.run())
      return out
    },
  }
}

describe('runPriceMatch dedup (regression for #43 review ②)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let env: any

  beforeEach(() => {
    db = makeDb()
    env = {
      DB: db,
      APP_BASE_URL: 'https://app.test',
      // dispatch() inspects user.notification_channels; default to email-only.
    }
    // user
    db._t.users.push({
      id: 1,
      email: 'u@x.test',
      name: 'User',
      picture: null,
      notification_email: 'u@x.test',
      notification_channels: JSON.stringify(['email']),
    })
    // 3 products that have all dropped in price
    for (let i = 1; i <= 3; i++) {
      db._t.products.push({
        code: `p${i}`,
        zh_name: `Product ${i}`,
        current_price: 80,
        base_price: 100,
        discount_price: 20,
        image_url: null,
        url: `https://p${i}`,
      })
    }
    // 3 watchlist items, purchased 5 days ago at 100
    const today = new Date()
    const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    for (let i = 1; i <= 3; i++) {
      db._t.watchlist_items.push({
        id: i,
        user_id: 1,
        product_code: `p${i}`,
        purchase_price: 100,
        purchase_date: fiveDaysAgo,
        status: 'active',
        notes: null,
        created_at: '2026-04-30T00:00:00Z',
        updated_at: '2026-04-30T00:00:00Z',
      })
    }
  })

  it('persists one dedup_key row per item in the digest', async () => {
    const out = await runPriceMatch(env)
    expect(out.errors).toBe(0)
    // notifications_log should have 1 row for the dispatched email + 2 marker
    // rows for items 2 & 3 = 3 sent rows total.
    const sent = db._t.notifications_log.filter(
      (r: { status: string }) => r.status === 'sent',
    )
    expect(sent).toHaveLength(3)
    const keys = new Set(sent.map((r: { dedup_key: string }) => r.dedup_key))
    expect(keys).toEqual(
      new Set([
        'pricematch:1:80',
        'pricematch:2:80',
        'pricematch:3:80',
      ]),
    )
  })

  it('a second run with unchanged prices sends nothing', async () => {
    await runPriceMatch(env)
    const before = db._t.notifications_log.length
    const out = await runPriceMatch(env)
    expect(out.notifications).toBe(0)
    // Second run must not create more sent rows.
    const sentAfter = db._t.notifications_log.filter(
      (r: { status: string }) => r.status === 'sent',
    ).length
    expect(sentAfter).toBe(before)
  })
})
