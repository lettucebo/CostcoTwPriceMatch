import { describe, it, expect } from 'vitest'
import {
  DateStringSchema,
  ProductHistoryDaysQuerySchema,
} from '@costco/shared'

describe('DateStringSchema (#25)', () => {
  it('accepts a real date', () => {
    expect(DateStringSchema.safeParse('2026-05-05').success).toBe(true)
  })

  it('accepts leap-year Feb 29', () => {
    expect(DateStringSchema.safeParse('2024-02-29').success).toBe(true)
  })

  it('rejects Feb 29 on a non-leap year', () => {
    expect(DateStringSchema.safeParse('2025-02-29').success).toBe(false)
  })

  it('rejects impossible dates with valid shape', () => {
    for (const s of ['2026-02-31', '2026-13-01', '2026-99-99', '2026-04-31']) {
      expect(DateStringSchema.safeParse(s).success).toBe(false)
    }
  })

  it('rejects malformed strings', () => {
    for (const s of ['', '2026/05/05', '26-5-5', 'not a date', '2026-5-5']) {
      expect(DateStringSchema.safeParse(s).success).toBe(false)
    }
  })
})

describe('ProductHistoryDaysQuerySchema (#27)', () => {
  it('coerces numeric strings', () => {
    expect(ProductHistoryDaysQuerySchema.parse('30')).toBe(30)
  })

  it('defaults to 90 when undefined', () => {
    expect(ProductHistoryDaysQuerySchema.parse(undefined)).toBe(90)
  })

  it('rejects non-numeric strings (#27 — would have crashed route)', () => {
    expect(ProductHistoryDaysQuerySchema.safeParse('abc').success).toBe(false)
  })

  it('rejects out-of-range values', () => {
    expect(ProductHistoryDaysQuerySchema.safeParse('0').success).toBe(false)
    expect(ProductHistoryDaysQuerySchema.safeParse('-1').success).toBe(false)
    expect(ProductHistoryDaysQuerySchema.safeParse('999999').success).toBe(false)
  })

  it('rejects non-integer values', () => {
    expect(ProductHistoryDaysQuerySchema.safeParse('1.5').success).toBe(false)
  })
})
