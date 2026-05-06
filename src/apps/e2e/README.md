# End-to-end tests (Playwright)

Smoke / regression tests that drive a real browser against the locally-built
dev stack. Tracks issue [#13](https://github.com/lettucebo/CostcoTwPriceMatch/issues/13).

## Run locally

```bash
# 1. Install Chromium (once, ~150 MB)
pnpm --filter @costco/e2e run install:browsers

# 2. Start the dev stack in another terminal
pnpm dev      # web :5173 + api :8787

# 3. Run the suite
pnpm --filter @costco/e2e run e2e
# or with a visible browser:
pnpm --filter @costco/e2e run e2e:headed
```

## Why is this not in CI?

Cloudflare Free plan + GitHub Actions free runners can run Playwright, but the
chromium download (≈ 150 MB cached) and the dev-server orchestration push CI
runtime well beyond the unit-test budget for personal-use scope. Run locally
before deployment until / unless we set up a paid CI tier.

## Extending the suite

Each test file lives under `tests/*.spec.ts`. Use Playwright's auto-waiting
locators (`getByRole`, `getByText`) and Page Object pattern for anything more
complex than a smoke test.
