import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for end-to-end tests against the locally-built dev stack.
 *
 * Usage:
 *   pnpm dev                           # starts api (8787) + web (5173) in parallel
 *   pnpm --filter @costco/e2e test     # runs the smoke suite
 *
 * CI does NOT yet run Playwright (chromium download + dev-server orchestration
 * is heavy for the CF Free plan). This is the scaffold for future work tracked
 * by issue #13 (originally punted in the initial implementation).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
