# PWA assets

This directory holds static assets served at the site root.

## Required PWA icons

The following must be generated **before production build**:

| File | Size | Purpose |
| --- | --- | --- |
| `favicon.ico` | 32x32 (multi-size ICO) | Browser tab |
| `apple-touch-icon.png` | 180x180 | iOS home screen |
| `pwa-192x192.png` | 192x192 | Android (any) |
| `pwa-512x512.png` | 512x512 | Android (any) |
| `pwa-512x512-maskable.png` | 512x512 | Android (maskable) |

Easiest: use the official `@vite-pwa/assets-generator` tool against `pwa-icon.svg`:

```bash
pnpm dlx @vite-pwa/assets-generator --preset minimal-2023 pwa-icon.svg
```

Or any online "PWA icon generator" → drop `pwa-icon.svg` → download → put files here.
