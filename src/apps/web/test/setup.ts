import '@testing-library/jest-dom/vitest'

// Vite injects import.meta.env.VITE_API_BASE_URL via define; provide a default
// so the fail-loud check in src/lib/api.ts doesn't throw during tests.
// (vitest sets `import.meta.env.PROD = false` so the throw branch is skipped,
// but DEV builds still read the var, so default to a localhost stub.)
if (!('VITE_API_BASE_URL' in (import.meta.env as Record<string, unknown>))) {
  ;(import.meta.env as Record<string, unknown>).VITE_API_BASE_URL =
    'http://localhost:8787'
}
