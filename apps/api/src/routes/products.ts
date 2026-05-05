import { Hono } from 'hono'
import type { AppContext } from '../env.js'
import { requireAuth } from '../auth/middleware.js'
import type { ProductRow, PriceHistoryRow } from '@costco/shared'

export const productsRouter = new Hono<AppContext>()

productsRouter.use('*', requireAuth)

productsRouter.get('/:code', async (c) => {
  const code = c.req.param('code')
  const product = await c.env.DB
    .prepare(
      `SELECT code, zh_name, en_name, current_price, base_price, discount_price,
              unit_price, unit_type, url, image_url, in_stock, stock_level,
              last_checked_at
       FROM products WHERE code = ?`,
    )
    .bind(code)
    .first<ProductRow>()
  if (!product) return c.json({ error: 'not_found' }, 404)
  return c.json({ ...product, in_stock: product.in_stock === 1 })
})

productsRouter.get('/:code/history', async (c) => {
  const code = c.req.param('code')
  const days = Math.min(Number(c.req.query('days') ?? 90), 365)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, price, base_price, discount_price, in_stock, observed_at
       FROM price_history
       WHERE product_code = ? AND observed_at >= ?
       ORDER BY observed_at ASC`,
    )
    .bind(code, since)
    .all<PriceHistoryRow>()
  return c.json({ history: results })
})

productsRouter.get('/:code/stats', async (c) => {
  const code = c.req.param('code')
  const stats = await c.env.DB
    .prepare(
      `SELECT MIN(price) AS min_price, MAX(price) AS max_price, AVG(price) AS avg_price,
              COUNT(*) AS sample_count
       FROM price_history WHERE product_code = ?`,
    )
    .bind(code)
    .first<{
      min_price: number | null
      max_price: number | null
      avg_price: number | null
      sample_count: number
    }>()
  return c.json(stats ?? { min_price: null, max_price: null, avg_price: null, sample_count: 0 })
})
