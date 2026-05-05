# PWA assets

This directory holds static assets served at the site root.

## Required PWA icons

The following are referenced by the PWA manifest in `vite.config.ts` and **must
exist** for the install card / Lighthouse PWA audit to pass:

| File | Size | Purpose |
| --- | --- | --- |
| `apple-touch-icon.png` | 180x180 | iOS home screen |
| `pwa-192x192.png` | 192x192 | Android (any) |
| `pwa-512x512.png` | 512x512 | Android (any) |
| `pwa-512x512-maskable.png` | 512x512 | Android (maskable) |

Source: `pwa-icon.svg` (committed). Two ways to (re)generate the PNGs:

### Option 1 — proper icons via `@vite-pwa/assets-generator` (Linux / macOS)

```bash
pnpm --filter @costco/web run assets:pwa
```

Requires a working `sharp` install. Configuration: `../pwa-assets.config.ts`.
This is the canonical path; re-run whenever `pwa-icon.svg` changes.

### Option 2 — placeholder solid-colour PNGs (any platform, no native deps)

```bash
node src/apps/web/scripts/generate-placeholder-icons.mjs
```

Uses only Node stdlib (`zlib` + `Buffer`). The PNGs are solid `#1a1a2e`
rectangles at the right sizes — good enough to keep the manifest valid, not
good enough for production polish. The currently-committed icons were produced
this way because `sharp` doesn't currently load on Node 24 + Windows in the
maintainer's dev env.
