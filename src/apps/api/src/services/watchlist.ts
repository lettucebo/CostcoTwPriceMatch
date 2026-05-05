import type { Context } from 'hono'
import {
  CreateWatchlistItemSchema,
  UpdateWatchlistItemSchema,
  type ProductRow,
  type WatchlistItemRow,
  type WatchlistItemView,
} from '@costco/shared'
import type { AppContext } from '../env.js'
import { fetchAndUpsertProduct, computeDays } from './products.js'

const REFRESH_RATE_LIMIT_SEC = 60 * 60 // 1/hr per product

/** GET /api/watchlist */
export async function listWatchlist(c: Context<AppContext>) {
  const userId = c.get('userId')
  const { results } = await c.env.DB
    .prepare(
      `SELECT
         w.id, w.purchase_price, w.purchase_date, w.status, w.notes, w.created_at,
         p.code, p.zh_name, p.en_name, p.current_price, p.base_price, p.discount_price,
         p.url, p.image_url, p.in_stock, p.last_checked_at
       FROM watchlist_items w
       JOIN products p ON p.code = w.product_code
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`,
    )
    .bind(userId)
    .all<
      WatchlistItemRow & {
        code: string
        zh_name: string
        en_name: string | null
        current_price: number
        base_price: number | null
        discount_price: number | null
        url: string
        image_url: string | null
        in_stock: 0 | 1
        last_checked_at: string
      }
    >()
  const items: WatchlistItemView[] = results.map((r) => toView(r))
  return c.json({ items })
}

/** POST /api/watchlist */
export async function createWatchlistItem(c: Context<AppContext>) {
  const userId = c.get('userId')
  const body = CreateWatchlistItemSchema.parse(await c.req.json())

  // Ensure product exists in our cache; fetch from Costco if not.
  const exists = await c.env.DB
    .prepare('SELECT 1 FROM products WHERE code = ?')
    .bind(body.code)
    .first()
  if (!exists) {
    const ok = await fetchAndUpsertProduct(c.env.DB, body.code)
    if (!ok) {
      return c.json({ error: 'product_not_found', code: body.code }, 404)
    }
  }

  try {
    const result = await c.env.DB
      .prepare(
        `INSERT INTO watchlist_items
           (user_id, product_code, purchase_price, purchase_date, notes)
         VALUES (?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        userId,
        body.code,
        body.purchase_price,
        body.purchase_date,
        body.notes ?? null,
      )
      .first<{ id: number }>()
    return c.json({ id: result?.id }, 201)
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint/i.test(err.message)) {
      return c.json(
        {
          error: 'duplicate',
          message: 'Already tracking this product on this purchase date.',
        },
        409,
      )
    }
    throw err
  }
}

/** GET /api/watchlist/:id */
export async function getWatchlistItem(c: Context<AppContext>) {
  const userId = c.get('userId')
  const id = Number(c.req.param('id'))
  const row = await c.env.DB
    .prepare(
      `SELECT
         w.id, w.purchase_price, w.purchase_date, w.status, w.notes, w.created_at,
         p.code, p.zh_name, p.en_name, p.current_price, p.base_price, p.discount_price,
         p.url, p.image_url, p.in_stock, p.last_checked_at
       FROM watchlist_items w
       JOIN products p ON p.code = w.product_code
       WHERE w.id = ? AND w.user_id = ?`,
    )
    .bind(id, userId)
    .first<
      WatchlistItemRow & {
        code: string
        zh_name: string
        en_name: string | null
        current_price: number
        base_price: number | null
        discount_price: number | null
        url: string
        image_url: string | null
        in_stock: 0 | 1
        last_checked_at: string
      }
    >()
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(toView(row))
}

/** PATCH /api/watchlist/:id */
export async function updateWatchlistItem(c: Context<AppContext>) {
  const userId = c.get('userId')
  const id = Number(c.req.param('id'))
  const body = UpdateWatchlistItemSchema.parse(await c.req.json())
  const sets: string[] = []
  const params: unknown[] = []
  if (body.purchase_price !== undefined) {
    sets.push('purchase_price = ?')
    params.push(body.purchase_price)
  }
  if (body.purchase_date !== undefined) {
    sets.push('purchase_date = ?')
    params.push(body.purchase_date)
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?')
    params.push(body.notes)
  }
  if (body.status !== undefined) {
    sets.push('status = ?')
    params.push(body.status)
  }
  if (sets.length === 0) return c.json({ ok: true })
  sets.push("updated_at = datetime('now')")
  params.push(id, userId)
  const res = await c.env.DB
    .prepare(
      `UPDATE watchlist_items SET ${sets.join(', ')}
       WHERE id = ? AND user_id = ?`,
    )
    .bind(...params)
    .run()
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
}

/** DELETE /api/watchlist/:id */
export async function deleteWatchlistItem(c: Context<AppContext>) {
  const userId = c.get('userId')
  const id = Number(c.req.param('id'))
  const res = await c.env.DB
    .prepare('DELETE FROM watchlist_items WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404)
  return c.json({ ok: true })
}

/** POST /api/watchlist/:id/refresh — manual price check, rate limited 1/hr/product. */
export async function refreshWatchlistItem(c: Context<AppContext>) {
  const userId = c.get('userId')
  const id = Number(c.req.param('id'))
  const item = await c.env.DB
    .prepare(
      'SELECT product_code FROM watchlist_items WHERE id = ? AND user_id = ?',
    )
    .bind(id, userId)
    .first<{ product_code: string }>()
  if (!item) return c.json({ error: 'not_found' }, 404)

  // Per-product KV-based limit
  const lockKey = `refresh-lock:${item.product_code}`
  const locked = await c.env.KV_CACHE.get(lockKey)
  if (locked) {
    return c.json(
      { error: 'rate_limited', retry_after_seconds: REFRESH_RATE_LIMIT_SEC },
      429,
    )
  }
  await c.env.KV_CACHE.put(lockKey, '1', {
    expirationTtl: REFRESH_RATE_LIMIT_SEC,
  })

  const ok = await fetchAndUpsertProduct(c.env.DB, item.product_code)
  if (!ok) return c.json({ error: 'product_not_found' }, 404)

  const updated = await c.env.DB
    .prepare(
      'SELECT current_price, last_checked_at FROM products WHERE code = ?',
    )
    .bind(item.product_code)
    .first<Pick<ProductRow, 'current_price' | 'last_checked_at'>>()
  return c.json({ ok: true, ...updated })
}

function toView(
  r: WatchlistItemRow & {
    code: string
    zh_name: string
    en_name: string | null
    current_price: number
    base_price: number | null
    discount_price: number | null
    url: string
    image_url: string | null
    in_stock: 0 | 1
    last_checked_at: string
  },
): WatchlistItemView {
  const { days_remaining } = computeDays(r.purchase_date)
  const price_diff = r.purchase_price - r.current_price
  // days_remaining === 0 is the LAST valid day (`<= 30 days from purchase`).
  // Filter must be `>= 0`, not `> 0`, otherwise the dashboard tells the user
  // a same-day price drop is no longer claimable on the final eligible day.
  const is_eligible = price_diff > 0 && days_remaining >= 0
  return {
    id: r.id,
    product: {
      code: r.code,
      zh_name: r.zh_name,
      en_name: r.en_name,
      current_price: r.current_price,
      base_price: r.base_price,
      discount_price: r.discount_price,
      url: r.url,
      image_url: r.image_url,
      in_stock: r.in_stock === 1,
      last_checked_at: r.last_checked_at,
    },
    purchase_price: r.purchase_price,
    purchase_date: r.purchase_date,
    status: r.status,
    notes: r.notes,
    price_diff,
    days_remaining,
    is_eligible,
    created_at: r.created_at,
  }
}
