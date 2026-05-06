import { describe, it, expect } from 'vitest'
import { alertThreshold } from '../src/notify/alert.js'
import type { Env } from '../src/env.js'

function envWith(threshold: string | undefined): Env {
  return { CRON_ALERT_THRESHOLD: threshold } as unknown as Env
}

describe('alertThreshold (#45 review ②)', () => {
  it('defaults to 5 when unset', () => {
    expect(alertThreshold(envWith(undefined))).toBe(5)
  })

  it('parses integer strings', () => {
    expect(alertThreshold(envWith('10'))).toBe(10)
    expect(alertThreshold(envWith('0'))).toBe(0)
  })

  it('floors fractional values so "0.5" does not mean "alert on every error"', () => {
    expect(alertThreshold(envWith('0.5'))).toBe(0)
    expect(alertThreshold(envWith('5.9'))).toBe(5)
  })

  it('clamps absurdly large values to 1000', () => {
    expect(alertThreshold(envWith('999999999'))).toBe(1000)
  })

  it('treats empty string as 0 (Number("") === 0 — disables alerts)', () => {
    expect(alertThreshold(envWith(''))).toBe(0)
  })

  it('rejects non-numeric / negative strings (falls back to 5)', () => {
    expect(alertThreshold(envWith('abc'))).toBe(5)
    expect(alertThreshold(envWith('-1'))).toBe(5)
    expect(alertThreshold(envWith('NaN'))).toBe(5)
  })
})
