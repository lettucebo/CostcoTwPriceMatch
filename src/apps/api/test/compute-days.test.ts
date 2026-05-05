import { describe, it, expect } from 'vitest'
import { computeDays } from '../src/services/products.js'

describe('computeDays', () => {
  it('today equals purchase => days_remaining=30', () => {
    const today = new Date('2026-05-05T08:00:00Z')
    const r = computeDays('2026-05-05', today)
    expect(r.days_since).toBe(0)
    expect(r.days_remaining).toBe(30)
  })

  it('5 days after purchase => days_remaining=25', () => {
    const today = new Date('2026-05-05T08:00:00Z')
    const r = computeDays('2026-04-30', today)
    expect(r.days_since).toBe(5)
    expect(r.days_remaining).toBe(25)
  })

  it('exactly day 30 => days_remaining=0 (last day)', () => {
    const today = new Date('2026-05-05T08:00:00Z')
    const r = computeDays('2026-04-05', today)
    expect(r.days_since).toBe(30)
    expect(r.days_remaining).toBe(0)
  })

  it('day 31 => days_remaining=-1 (expired)', () => {
    const today = new Date('2026-05-05T08:00:00Z')
    const r = computeDays('2026-04-04', today)
    expect(r.days_since).toBe(31)
    expect(r.days_remaining).toBe(-1)
  })

  it('purchase in the future clamps to 0', () => {
    const today = new Date('2026-05-05T08:00:00Z')
    const r = computeDays('2026-05-10', today)
    expect(r.days_since).toBe(0)
    expect(r.days_remaining).toBe(30)
  })

  it('does not break across UTC midnight boundary', () => {
    // Almost midnight UTC
    const today = new Date('2026-05-05T23:59:59Z')
    const r = computeDays('2026-05-05', today)
    expect(r.days_since).toBe(0)
    expect(r.days_remaining).toBe(30)
  })
})
