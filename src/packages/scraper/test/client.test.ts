import { describe, it, expect, vi } from 'vitest'
import {
  fetchAllByCategory,
  fetchProductByCode,
  fetchCategoryPage,
  searchProducts,
  CostcoApiError,
} from '../src/client.js'
import page1 from './fixtures/search-page-1.json' with { type: 'json' }
import page2 from './fixtures/search-page-2.json' with { type: 'json' }
import productOnSale from './fixtures/product-on-sale.json' with { type: 'json' }

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('client', () => {
  // Default options for existing tests — disables the courtesy throttle so the
  // suite stays fast. The throttle itself is exercised by the dedicated
  // describe block below using fake timers.
  const noThrottle = { minGapMs: 0 }

  it('fetchCategoryPage: builds correct URL params', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse(page1))
    await fetchCategoryPage('hot-buys', 0, { fetcher, ...noThrottle })
    const url = fetcher.mock.calls[0]![0] as string
    expect(url).toContain('rest/v2/taiwan/products/search')
    expect(url).toContain('pageSize=100')
    expect(url).toContain('currentPage=0')
    expect(url).toContain('sort=price-asc')
    expect(url).toContain('lang=zh_TW')
    expect(url).toContain('curr=TWD')
    expect(url).toContain('category=hot-buys')
  })

  it('fetchAllByCategory: paginates through totalPages', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(page1))
      .mockResolvedValueOnce(mockJsonResponse(page2))
    const products = await fetchAllByCategory('hot-buys', { fetcher, ...noThrottle })
    expect(products).toHaveLength(3)
    expect(products[0]!.code).toBe('100001')
    expect(products[2]!.code).toBe('100003')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fetchAllByCategory: respects limit', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(mockJsonResponse(page1))
    const products = await fetchAllByCategory('hot-buys', {
      fetcher,
      ...noThrottle,
      limit: 1,
    })
    expect(products).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fetchProductByCode: returns product on 200', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse(productOnSale))
    const p = await fetchProductByCode('217455', { fetcher, ...noThrottle })
    expect(p?.code).toBe('217455')
  })

  it('fetchProductByCode: returns null on 404', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('not found', { status: 404 }),
    )
    const p = await fetchProductByCode('00000', { fetcher, ...noThrottle })
    expect(p).toBeNull()
  })

  it('retries on 5xx and eventually succeeds', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(mockJsonResponse(productOnSale))
    const p = await fetchProductByCode('217455', { fetcher, ...noThrottle, maxRetries: 3 })
    expect(p?.code).toBe('217455')
    expect(fetcher).toHaveBeenCalledTimes(2)
  }, 20_000)

  it('throws CostcoApiError on terminal 4xx (other than 404)', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('bad', { status: 400 }))
    await expect(
      fetchProductByCode('217455', { fetcher, ...noThrottle, maxRetries: 1 }),
    ).rejects.toBeInstanceOf(CostcoApiError)
  })

  it('searchProducts: passes query in URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse(page1))
    await searchProducts('Ariel', { fetcher, ...noThrottle })
    const url = fetcher.mock.calls[0]![0] as string
    expect(url).toContain('query=Ariel')
    expect(url).toContain('sort=relevance')
  })

  it('sets correct Accept and User-Agent headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse(page1))
    await fetchCategoryPage('hot-buys', 0, { fetcher, ...noThrottle })
    const init = fetcher.mock.calls[0]![1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Accept).toBe('application/json')
    expect(headers['User-Agent']).toContain('CostcoTwPriceMatch')
  })
})

describe('throttle (#29)', () => {
  it('serializes concurrent calls with at least minGapMs between them', async () => {
    const events: number[] = []
    let nowMs = 0
    const realDateNow = Date.now
    Date.now = () => nowMs

    const fetcher = vi.fn().mockImplementation(async () => {
      events.push(nowMs)
      // Each call must return a fresh Response — bodies are single-use streams.
      return mockJsonResponse(page1)
    })

    // Patch global setTimeout so `sleep(ms)` in the throttle just advances
    // our virtual clock and resolves on next microtask.
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      nowMs += ms
      Promise.resolve().then(fn)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout

    try {
      await Promise.all([
        fetchCategoryPage('hot-buys', 0, { fetcher, minGapMs: 1100 }),
        fetchCategoryPage('hot-buys', 1, { fetcher, minGapMs: 1100 }),
        fetchCategoryPage('hot-buys', 2, { fetcher, minGapMs: 1100 }),
      ])
    } finally {
      globalThis.setTimeout = realSetTimeout
      Date.now = realDateNow
    }

    expect(events).toHaveLength(3)
    // Three back-to-back calls means at least two gap windows between them.
    expect(events[1]! - events[0]!).toBeGreaterThanOrEqual(1100)
    expect(events[2]! - events[1]!).toBeGreaterThanOrEqual(1100)
  })

  it('minGapMs=0 lets calls run back-to-back (virtual clock — no sleeps)', async () => {
    const events: number[] = []
    let nowMs = 0
    const realDateNow = Date.now
    Date.now = () => nowMs

    const fetcher = vi.fn().mockImplementation(async () => {
      events.push(nowMs)
      return mockJsonResponse(page1)
    })

    // Patch setTimeout: any call (other than 0ms) advances the virtual clock.
    // If the throttle were active with minGapMs=0 it should never call this
    // with > 0; if it did, the assertion below would catch it because the
    // timestamps would differ.
    const realSetTimeout = globalThis.setTimeout
    let timeoutsScheduled = 0
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      timeoutsScheduled++
      nowMs += ms
      Promise.resolve().then(fn)
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout

    try {
      await Promise.all([
        fetchCategoryPage('hot-buys', 0, { fetcher, minGapMs: 0 }),
        fetchCategoryPage('hot-buys', 1, { fetcher, minGapMs: 0 }),
      ])
    } finally {
      globalThis.setTimeout = realSetTimeout
      Date.now = realDateNow
    }

    expect(events).toHaveLength(2)
    // Both calls fired at the same virtual instant — no sleeps were inserted
    // between them. (Virtual clock means "no wall-clock dependence".)
    expect(events[1]).toBe(events[0])
    expect(timeoutsScheduled).toBe(0)
  })
})
