// Stubs filled in issue #7
import type {
  CostcoApiProduct,
  CostcoApiSearchResponse,
  CostcoCategory,
} from './types.js'

export interface FetchOptions {
  fetcher?: typeof fetch
  userAgent?: string
  signal?: AbortSignal
  /** Max retries on transient errors (5xx, network); default 3 */
  maxRetries?: number
  /**
   * Minimum gap (in ms) between two outbound calls to costco.com.tw,
   * enforced by a module-scoped queue. Default 1100. Set to 0 in tests.
   * Honors the personal-use ≤ 1 req/sec courtesy limit promised in
   * RUNBOOK / README.
   */
  minGapMs?: number
}

export class CostcoApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string,
  ) {
    super(message)
    this.name = 'CostcoApiError'
  }
}

const BASE = 'https://www.costco.com.tw/rest/v2/taiwan'
const DEFAULT_UA = 'Mozilla/5.0 CostcoTwPriceMatch/1.0 (personal use)'
const DEFAULT_MIN_GAP_MS = 1100

/**
 * Module-scoped serializing gate. Each `acquire()` call:
 *   1. Awaits the prior in-flight request to finish (one request at a time),
 *   2. Sleeps the remaining gap (so consecutive sends are spaced ≥ minGapMs apart),
 *   3. Returns a `release()` that the caller MUST invoke after their fetch
 *      resolves or rejects (use try/finally).
 *
 * Concurrent callers (cron + manual refresh, paging fan-out, etc.) all serialize
 * through the same chain so the worker cannot burst above the courtesy limit.
 */
let lastRequestEndedAt = 0
let queueTail: Promise<unknown> = Promise.resolve()
async function acquireGate(minGapMs: number): Promise<() => void> {
  const prev = queueTail
  let release: () => void = () => undefined
  queueTail = new Promise<void>((r) => {
    release = r
  })
  await prev
  const wait = lastRequestEndedAt + minGapMs - Date.now()
  if (wait > 0) await sleep(wait)
  return () => {
    lastRequestEndedAt = Date.now()
    release()
  }
}

export interface FetchCategoryOptions extends FetchOptions {
  /** 0-indexed page; default fetches all pages */
  startPage?: number
  /** Limit total products fetched (useful for tests) */
  limit?: number
  /** Page size, max 100 */
  pageSize?: number
}

/** Fetch one page of category search. Exposed for testability / pagination. */
export async function fetchCategoryPage(
  category: CostcoCategory | undefined,
  page: number,
  options: FetchOptions & { pageSize?: number } = {},
): Promise<CostcoApiSearchResponse> {
  const url = new URL(`${BASE}/products/search`)
  url.searchParams.set('pageSize', String(options.pageSize ?? 100))
  url.searchParams.set('currentPage', String(page))
  url.searchParams.set('sort', 'price-asc')
  url.searchParams.set('lang', 'zh_TW')
  url.searchParams.set('curr', 'TWD')
  if (category) url.searchParams.set('category', category)
  return getJson<CostcoApiSearchResponse>(url.toString(), options)
}

/** Fetch every page of a category until pagination is exhausted (or limit hit). */
export async function fetchAllByCategory(
  category: CostcoCategory | undefined,
  options: FetchCategoryOptions = {},
): Promise<CostcoApiProduct[]> {
  const all: CostcoApiProduct[] = []
  const limit = options.limit ?? Infinity
  let page = options.startPage ?? 0
  let totalPages = 1
  do {
    const json = await fetchCategoryPage(category, page, options)
    all.push(...json.products)
    totalPages = json.pagination?.totalPages ?? 1
    page++
    if (all.length >= limit) break
  } while (page < totalPages)
  return all.slice(0, limit)
}

/** Fetch a single product by Costco code. Returns null on 404. */
export async function fetchProductByCode(
  code: string,
  options: FetchOptions = {},
): Promise<CostcoApiProduct | null> {
  const url = `${BASE}/products/${encodeURIComponent(code)}?lang=zh_TW&curr=TWD`
  try {
    return await getJson<CostcoApiProduct>(url, options)
  } catch (err) {
    if (err instanceof CostcoApiError && err.status === 404) return null
    throw err
  }
}

/** Free-text search. */
export async function searchProducts(
  query: string,
  options: FetchOptions & { pageSize?: number; page?: number } = {},
): Promise<CostcoApiSearchResponse> {
  const url = new URL(`${BASE}/products/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('pageSize', String(options.pageSize ?? 24))
  url.searchParams.set('currentPage', String(options.page ?? 0))
  url.searchParams.set('sort', 'relevance')
  url.searchParams.set('lang', 'zh_TW')
  url.searchParams.set('curr', 'TWD')
  return getJson<CostcoApiSearchResponse>(url.toString(), options)
}

// ---- internals ----------------------------------------------------------

async function getJson<T>(url: string, options: FetchOptions): Promise<T> {
  const fetcher = options.fetcher ?? globalThis.fetch
  const ua = options.userAgent ?? DEFAULT_UA
  const maxRetries = options.maxRetries ?? 3
  const minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS
  let attempt = 0
  let lastError: unknown
  while (attempt < maxRetries) {
    try {
      const release = minGapMs > 0 ? await acquireGate(minGapMs) : null
      let res: Response
      try {
        res = await fetcher(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': ua,
          },
          signal: options.signal,
        })
      } finally {
        // Release the gate (and stamp lastRequestEndedAt) regardless of
        // success/failure so retries also wait the courtesy window.
        release?.()
      }
      if (!res.ok) {
        const body = await safeText(res)
        if (res.status === 404) {
          throw new CostcoApiError(404, body, `Costco API 404: ${url}`)
        }
        if (res.status >= 500 || res.status === 429) {
          // Retryable
          throw new CostcoApiError(
            res.status,
            body,
            `Costco API ${res.status} (will retry): ${url}`,
          )
        }
        throw new CostcoApiError(
          res.status,
          body,
          `Costco API ${res.status}: ${url}`,
        )
      }
      return (await res.json()) as T
    } catch (err) {
      lastError = err
      const isRetryable =
        err instanceof CostcoApiError
          ? err.status >= 500 || err.status === 429
          : true // network/abort errors are retryable except AbortError
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.name === 'TimeoutError')
      ) {
        throw err
      }
      attempt++
      if (!isRetryable || attempt >= maxRetries) {
        throw err
      }
      const delay = backoff(attempt)
      await sleep(delay)
    }
  }
  throw lastError ?? new Error('unknown error')
}

function backoff(attempt: number): number {
  // 500ms, 1500ms, 4500ms ...
  return Math.min(500 * 3 ** (attempt - 1), 10_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
