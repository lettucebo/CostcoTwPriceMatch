import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DashboardPage } from '../src/pages/DashboardPage.js'

/**
 * Regression test for #32: clicking refresh on one card must NOT disable the
 * refresh button on other cards. Before the fix every WatchlistCard received
 * `refresh.isPending` from a single shared mutation.
 */

const apiCalls: string[] = []
let resolveRefresh: ((v: unknown) => void) | null = null

vi.mock('../src/lib/api.js', () => ({
  api: vi.fn(async (path: string, init?: { method?: string }) => {
    apiCalls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/api/watchlist' && (!init?.method || init.method === 'GET')) {
      const today = new Date()
      const fiveDaysAgo = new Date(
        today.getTime() - 5 * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10)
      const item = (id: number, code: string, name: string) => ({
        id,
        product: {
          code,
          zh_name: name,
          en_name: null,
          current_price: 80,
          base_price: 100,
          discount_price: null,
          url: `https://www.costco.com.tw/p/${code}`,
          image_url: null,
          in_stock: true,
          last_checked_at: today.toISOString(),
        },
        purchase_price: 100,
        purchase_date: fiveDaysAgo,
        status: 'active',
        notes: null,
        price_diff: 20,
        days_remaining: 25,
        is_eligible: true,
        created_at: today.toISOString(),
      })
      return new Response(
        JSON.stringify({ items: [item(1, 'A1', '商品 A'), item(2, 'B2', '商品 B')] }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    if (init?.method === 'POST' && path.includes('/refresh')) {
      // Hold the refresh response open so we can observe the in-flight state.
      return new Promise<Response>((res) => {
        resolveRefresh = (v: unknown) => res(v as Response)
      })
    }
    return new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })
  }),
  API_BASE: '',
}))

function renderDashboard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<DashboardPage /> per-card refresh state (#32)', () => {
  beforeEach(() => {
    apiCalls.length = 0
    resolveRefresh = null
  })

  it('refreshing card A keeps card B refresh button enabled', async () => {
    renderDashboard()

    // Wait for the watchlist to render two cards.
    await waitFor(() =>
      expect(screen.getByText('商品 A')).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(screen.getByText('商品 B')).toBeInTheDocument(),
    )

    // Two refresh buttons, both initially "立即更新".
    const buttonsBefore = screen.getAllByRole('button', { name: '立即更新' })
    expect(buttonsBefore).toHaveLength(2)

    // Click refresh on card A. The mock holds the response open via
    // resolveRefresh so we can observe the partial state.
    fireEvent.click(buttonsBefore[0]!)

    // Card A flips to "更新中..." (and is disabled).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '更新中...' })).toBeDisabled(),
    )

    // Card B still has "立即更新" — NOT shared state.
    const stillEnabled = screen.getAllByRole('button', { name: '立即更新' })
    expect(stillEnabled).toHaveLength(1)
    expect(stillEnabled[0]).not.toBeDisabled()

    // Cleanup: complete the held refresh so the test can teardown.
    resolveRefresh?.(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' },
      }),
    )
  })
})
