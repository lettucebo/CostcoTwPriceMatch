import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WatchlistCard } from '../src/components/WatchlistCard.js'
import type { WatchlistItemView } from '@costco/shared'

function makeItem(overrides: Partial<WatchlistItemView> = {}): WatchlistItemView {
  return {
    id: 1,
    product: {
      code: '100001',
      zh_name: '測試商品',
      en_name: null,
      current_price: 800,
      base_price: 1000,
      discount_price: null,
      url: 'https://www.costco.com.tw/p/100001',
      image_url: null,
      in_stock: true,
      last_checked_at: '2026-05-05T00:00:00Z',
    },
    purchase_price: 1000,
    purchase_date: '2026-04-25',
    status: 'active',
    notes: null,
    price_diff: 200,
    days_remaining: 20,
    is_eligible: true,
    created_at: '2026-04-25T00:00:00Z',
    ...overrides,
  } as WatchlistItemView
}

function renderCard(props: {
  item?: WatchlistItemView
  refreshing?: boolean
}) {
  const onRefresh = vi.fn()
  const onDelete = vi.fn()
  render(
    <MemoryRouter>
      <WatchlistCard
        item={props.item ?? makeItem()}
        onRefresh={onRefresh}
        onDelete={onDelete}
        refreshing={props.refreshing ?? false}
      />
    </MemoryRouter>,
  )
  return { onRefresh, onDelete }
}

describe('<WatchlistCard />', () => {
  it('shows product name, code, and prices', () => {
    renderCard({})
    expect(screen.getByText('測試商品')).toBeInTheDocument()
    expect(screen.getByText('#100001')).toBeInTheDocument()
    expect(screen.getByText(/可退差價 \$200/)).toBeInTheDocument()
  })

  it('shows the "可退差價" badge when eligible', () => {
    renderCard({ item: makeItem({ is_eligible: true, days_remaining: 20 }) })
    expect(screen.getByText('可退差價')).toBeInTheDocument()
  })

  it('shows the "已過期" badge when days_remaining < 0', () => {
    renderCard({
      item: makeItem({ is_eligible: false, days_remaining: -1, status: 'expired' }),
    })
    expect(screen.getByText('已過期')).toBeInTheDocument()
  })

  it('refresh button is disabled when refreshing prop is true', () => {
    renderCard({ refreshing: true })
    const btn = screen.getByRole('button', { name: /更新中/ })
    expect(btn).toBeDisabled()
  })

  it('calls onRefresh when refresh button is clicked', () => {
    const { onRefresh } = renderCard({})
    fireEvent.click(screen.getByRole('button', { name: '立即更新' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('calls onDelete when remove button is clicked', () => {
    const { onDelete } = renderCard({})
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
