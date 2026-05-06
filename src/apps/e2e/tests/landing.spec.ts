import { test, expect } from '@playwright/test'

/**
 * Smoke test: unauthenticated visit lands on the login page with a Google
 * button pointing at the Workers /auth/google/login endpoint.
 *
 * This is a starter test for issue #13. Add more flows (login mock, watchlist
 * add, refresh, settings) as the e2e suite matures.
 */
test('unauthenticated landing redirects to /login with Google button', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForURL(/\/login/)

  // Brand visible
  await expect(page.getByText('CostcoMatch')).toBeVisible()

  // Google login button
  const link = page.getByRole('link', { name: /Google/i })
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  expect(href).toContain('/auth/google/login')
})
