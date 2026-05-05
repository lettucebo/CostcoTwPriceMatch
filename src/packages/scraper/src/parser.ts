// Stubs filled in issue #7
import type { CostcoApiProduct, ProductSummary } from './types.js'

export const COSTCO_TW_BASE = 'https://www.costco.com.tw'

/** Detect whether a Costco product is currently on sale. */
export function isOnSale(p: CostcoApiProduct): boolean {
  // Costco TW Hybris: discountPrice key only present when discounted
  return !!p.discountPrice && (p.discountPrice.value ?? 0) > 0
}

/** "Manager special" / clearance: price ends in 7. */
export function isManagerSpecial(p: CostcoApiProduct): boolean {
  const price = p.price?.value
  if (price == null) return false
  // Use modulo on cents to avoid floating point pain.
  return Math.round(price * 100) % 100 === 0 && Math.round(price) % 10 === 7
}

export function isInStock(p: CostcoApiProduct): boolean {
  return p.stock?.stockLevelStatus === 'inStock'
}

/** Choose the best image URL (prefer "product" or "results" format). */
export function primaryImageUrl(p: CostcoApiProduct): string | null {
  if (!p.images?.length) return null
  const order = ['product', 'results', 'carousel', 'thumbnail']
  for (const fmt of order) {
    const found = p.images.find((i) => i.format === fmt)
    if (found) return absUrl(found.url)
  }
  return absUrl(p.images[0]!.url)
}

export function absUrl(maybeRelative: string): string {
  if (/^https?:/i.test(maybeRelative)) return maybeRelative
  return `${COSTCO_TW_BASE}${maybeRelative.startsWith('/') ? '' : '/'}${maybeRelative}`
}

/** Convert raw Costco product into the lean summary we persist. */
export function toProductSummary(p: CostcoApiProduct): ProductSummary {
  const current = p.price?.value
  if (current == null)
    throw new Error(`product ${p.code} has no price (membership-restricted?)`)
  return {
    code: p.code,
    zh_name: p.name,
    en_name: p.englishName ?? null,
    current_price: current,
    base_price: p.basePrice?.value ?? null,
    discount_price: p.discountPrice?.value ?? null,
    unit_price: p.pricePerUnit?.value ?? null,
    unit_type: p.unitType ?? null,
    url: absUrl(p.url),
    image_url: primaryImageUrl(p),
    delivery_name: p.deliveryName ?? null,
    in_stock: isInStock(p),
    stock_level: p.stock?.stockLevel ?? null,
    is_on_sale: isOnSale(p),
    is_manager_special: isManagerSpecial(p),
  }
}

/** Try to extract a Costco TW product code from a URL. */
export function codeFromUrl(url: string): string | null {
  const m = url.match(/\/p\/(\d{4,9})(?:[/?#]|$)/)
  return m ? m[1]! : null
}
