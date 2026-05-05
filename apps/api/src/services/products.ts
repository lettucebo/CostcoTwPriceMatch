import type { D1Database } from '@cloudflare/workers-types'
import {
  toProductSummary,
  fetchProductByCode,
  type CostcoApiProduct,
} from '@costco/scraper'

/** Upsert a single Costco product into D1 from raw API JSON. */
export async function upsertProduct(
  db: D1Database,
  raw: CostcoApiProduct,
): Promise<void> {
  const s = toProductSummary(raw)
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO products (
        code, zh_name, en_name, current_price, base_price, discount_price,
        unit_price, unit_type, url, image_url, delivery_name, in_stock,
        stock_level, raw_json, last_checked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (code) DO UPDATE SET
        zh_name = excluded.zh_name,
        en_name = excluded.en_name,
        current_price = excluded.current_price,
        base_price = excluded.base_price,
        discount_price = excluded.discount_price,
        unit_price = excluded.unit_price,
        unit_type = excluded.unit_type,
        url = excluded.url,
        image_url = excluded.image_url,
        delivery_name = excluded.delivery_name,
        in_stock = excluded.in_stock,
        stock_level = excluded.stock_level,
        raw_json = excluded.raw_json,
        last_checked_at = excluded.last_checked_at`,
    )
    .bind(
      s.code,
      s.zh_name,
      s.en_name,
      s.current_price,
      s.base_price,
      s.discount_price,
      s.unit_price,
      s.unit_type,
      s.url,
      s.image_url,
      s.delivery_name,
      s.in_stock ? 1 : 0,
      s.stock_level,
      JSON.stringify(raw),
      now,
      now,
    )
    .run()
}

/** Append a price_history row for the current price snapshot. */
export async function appendPriceHistory(
  db: D1Database,
  raw: CostcoApiProduct,
): Promise<void> {
  const s = toProductSummary(raw)
  await db
    .prepare(
      `INSERT INTO price_history
        (product_code, price, base_price, discount_price, in_stock)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(s.code, s.current_price, s.base_price, s.discount_price, s.in_stock ? 1 : 0)
    .run()
}

/** Fetch from Costco + persist + append history. Returns null on 404. */
export async function fetchAndUpsertProduct(
  db: D1Database,
  code: string,
): Promise<boolean> {
  const raw = await fetchProductByCode(code)
  if (!raw) return false
  await upsertProduct(db, raw)
  await appendPriceHistory(db, raw)
  return true
}

/** Compute days_since/_remaining from purchase_date; today is `today` ISO string. */
export function computeDays(
  purchaseDate: string,
  todayUtc = new Date(),
): { days_since: number; days_remaining: number } {
  const purchase = new Date(purchaseDate + 'T00:00:00Z').getTime()
  const today = new Date(
    Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate(),
    ),
  ).getTime()
  const ms = today - purchase
  const days_since = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
  return { days_since, days_remaining: 30 - days_since }
}
