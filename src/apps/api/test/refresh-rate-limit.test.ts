import { describe, it, expect } from 'vitest'

/**
 * KV-backed rate limit tests for the watchlist refresh endpoint.
 *
 * TODO(#40): remove this entire spec when KV is replaced by D1 / cookie state.
 *            Tests below intentionally only cover the KV gate logic in
 *            isolation (no D1, no fetch) — the goal is just to prove the gate
 *            shape, not the full route. Once KV_CACHE is gone they have no
 *            reason to exist.
 */

const REFRESH_RATE_LIMIT_SEC = 60 * 60 // 1 hour, matches services/watchlist.ts

interface KvEntry {
  value: string
  expiresAt: number
}

class FakeKv {
  store = new Map<string, KvEntry>()

  async get(key: string): Promise<string | null> {
    const v = this.store.get(key)
    if (!v) return null
    if (v.expiresAt > 0 && v.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }
    return v.value
  }

  async put(
    key: string,
    value: string,
    opts: { expirationTtl: number },
  ): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + opts.expirationTtl * 1000,
    })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
}

/** Mirrors the gate in `src/apps/api/src/services/watchlist.ts:refreshOne`. */
async function tryAcquireRefresh(
  kv: FakeKv,
  productCode: string,
): Promise<{ allowed: true } | { allowed: false; retryAfterSec: number }> {
  const lockKey = `refresh-lock:${productCode}`
  const locked = await kv.get(lockKey)
  if (locked) {
    return { allowed: false, retryAfterSec: REFRESH_RATE_LIMIT_SEC }
  }
  await kv.put(lockKey, '1', { expirationTtl: REFRESH_RATE_LIMIT_SEC })
  return { allowed: true }
}

describe('refresh rate-limit (KV gate)', () => {
  it('allows the first call', async () => {
    const kv = new FakeKv()
    const r = await tryAcquireRefresh(kv, 'p1')
    expect(r.allowed).toBe(true)
  })

  it('rejects a second call within the TTL window', async () => {
    const kv = new FakeKv()
    await tryAcquireRefresh(kv, 'p1')
    const r = await tryAcquireRefresh(kv, 'p1')
    expect(r.allowed).toBe(false)
    if (!r.allowed) {
      expect(r.retryAfterSec).toBe(3600)
    }
  })

  it('isolates per-product locks', async () => {
    const kv = new FakeKv()
    await tryAcquireRefresh(kv, 'p1')
    const r = await tryAcquireRefresh(kv, 'p2')
    expect(r.allowed).toBe(true)
  })

  it('allows again after the TTL expires', async () => {
    const kv = new FakeKv()
    await tryAcquireRefresh(kv, 'p1')
    // Force expiry on the entry without waiting wall-clock.
    const entry = kv.store.get('refresh-lock:p1')!
    entry.expiresAt = Date.now() - 1000
    const r = await tryAcquireRefresh(kv, 'p1')
    expect(r.allowed).toBe(true)
  })
})
