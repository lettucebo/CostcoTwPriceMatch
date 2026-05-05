import { describe, it, expect } from 'vitest'
import {
  isOnSale,
  isManagerSpecial,
  isInStock,
  primaryImageUrl,
  toProductSummary,
  codeFromUrl,
  absUrl,
} from '../src/parser.js'
import onSale from './fixtures/product-on-sale.json' with { type: 'json' }
import managerSpecial from './fixtures/product-manager-special.json' with { type: 'json' }
import type { CostcoApiProduct } from '../src/types.js'

const ONSALE = onSale as unknown as CostcoApiProduct
const MGR = managerSpecial as unknown as CostcoApiProduct

describe('parser', () => {
  it('isOnSale: true when discountPrice is set', () => {
    expect(isOnSale(ONSALE)).toBe(true)
  })
  it('isOnSale: false when no discountPrice', () => {
    expect(isOnSale(MGR)).toBe(false)
  })

  it('isManagerSpecial: detects price ending in 7 (e.g. 527)', () => {
    expect(isManagerSpecial(MGR)).toBe(true)
  })
  it('isManagerSpecial: false for 719', () => {
    expect(isManagerSpecial(ONSALE)).toBe(false)
  })

  it('isInStock: respects stockLevelStatus', () => {
    expect(isInStock(ONSALE)).toBe(true)
  })

  it('primaryImageUrl: prefers product format and absolutises', () => {
    const url = primaryImageUrl(ONSALE)
    expect(url).toMatch(/^https:\/\/www\.costco\.com\.tw\/medias\//)
    expect(url).toContain('h21/ha1')
  })

  it('absUrl: leaves absolute URLs alone', () => {
    expect(absUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })

  it('toProductSummary: maps fields cleanly', () => {
    const s = toProductSummary(ONSALE)
    expect(s.code).toBe('217455')
    expect(s.zh_name).toBe('Ariel 抗菌抗臭洗衣精補充包 1260公克 X 6入')
    expect(s.current_price).toBe(719)
    expect(s.base_price).toBe(899)
    expect(s.discount_price).toBe(180)
    expect(s.unit_price).toBe(5)
    expect(s.unit_type).toBe('蓋杯')
    expect(s.in_stock).toBe(true)
    expect(s.is_on_sale).toBe(true)
    expect(s.is_manager_special).toBe(false)
  })

  it('toProductSummary: throws on membership-only (no price)', () => {
    const noPrice = {
      code: 'X',
      name: 'X',
      url: '/p/X',
      stock: { stockLevelStatus: 'inStock' },
    } as unknown as CostcoApiProduct
    expect(() => toProductSummary(noPrice)).toThrow()
  })

  it('codeFromUrl: extracts /p/{code} pattern', () => {
    expect(codeFromUrl('https://www.costco.com.tw/foo/bar/p/217455')).toBe('217455')
    expect(codeFromUrl('/p/100001')).toBe('100001')
    expect(codeFromUrl('/p/100002?tag=x')).toBe('100002')
    expect(codeFromUrl('/no-code-here')).toBeNull()
  })
})
