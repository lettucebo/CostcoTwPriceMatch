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
  it('fetchCategoryPage: builds correct URL params', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse(page1))
    await fetchCategoryPage('hot-buys', 0, { fetcher })
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
    const products = await fetchAllByCategory('hot-buys', { fetcher })
    expect(products).toHaveLength(3)
    expect(products[0]!.code).toBe('100001')
    expect(products[2]!.code).toBe('100003')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fetchAllByCategory: respects limit', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(mockJsonResponse(page1))
    const products = await fetchAllByCategory('hot-buys', {
      fetcher,
      limit: 1,
    })
    expect(products).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fetchProductByCode: returns product on 200', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse(productOnSale))
    const p = await fetchProductByCode('217455', { fetcher })
    expect(p?.code).toBe('217455')
  })

  it('fetchProductByCode: returns null on 404', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('not found', { status: 404 }),
    )
    const p = await fetchProductByCode('00000', { fetcher })
    expect(p).toBeNull()
  })

  it('retries on 5xx and eventually succeeds', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 503 }))
      .mockResolvedValueOnce(mockJsonResponse(productOnSale))
    const p = await fetchProductByCode('217455', { fetcher, maxRetries: 3 })
    expect(p?.code).toBe('217455')
    expect(fetcher).toHaveBeenCalledTimes(2)
  }, 20_000)

  it('throws CostcoApiError on terminal 4xx (other than 404)', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('bad', { status: 400 }))
    await expect(
      fetchProductByCode('217455', { fetcher, maxRetries: 1 }),
    ).rejects.toBeInstanceOf(CostcoApiError)
  })

  it('searchProducts: passes query in URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse(page1))
    await searchProducts('Ariel', { fetcher })
    const url = fetcher.mock.calls[0]![0] as string
    expect(url).toContain('query=Ariel')
    expect(url).toContain('sort=relevance')
  })

  it('sets correct Accept and User-Agent headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse(page1))
    await fetchCategoryPage('hot-buys', 0, { fetcher })
    const init = fetcher.mock.calls[0]![1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Accept).toBe('application/json')
    expect(headers['User-Agent']).toContain('CostcoTwPriceMatch')
  })
})
