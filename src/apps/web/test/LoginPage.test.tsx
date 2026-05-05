import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoginPage } from '../src/pages/LoginPage.js'

describe('<LoginPage />', () => {
  it('renders the Google login button pointing at /auth/google/login', () => {
    render(<LoginPage />)
    const link = screen.getByRole('link', { name: /Google/i })
    expect(link).toHaveAttribute('href')
    expect(link.getAttribute('href')).toContain('/auth/google/login')
  })

  it('shows the brand name and Chinese tagline', () => {
    render(<LoginPage />)
    expect(screen.getByText(/CostcoMatch/)).toBeInTheDocument()
    expect(screen.getByText(/追蹤 Costco 台灣商品價格/)).toBeInTheDocument()
  })
})
