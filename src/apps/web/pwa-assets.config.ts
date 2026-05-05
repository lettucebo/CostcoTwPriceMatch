import { defineConfig, minimalPreset } from '@vite-pwa/assets-generator/config'

/**
 * Generate PWA PNG icons from public/pwa-icon.svg.
 * Run with: pnpm --filter @costco/web run assets:pwa
 *
 * Outputs:
 *   public/pwa-192x192.png
 *   public/pwa-512x512.png
 *   public/pwa-512x512-maskable.png   (maskable: square with safe-area padding)
 *   public/apple-touch-icon.png       (180x180)
 *   public/favicon.ico                (multi-resolution)
 */
export default defineConfig({
  preset: {
    ...minimalPreset,
    maskable: {
      sizes: [512],
      padding: 0.3,
      resizeOptions: { background: '#1a1a2e' },
    },
    apple: {
      sizes: [180],
      padding: 0.3,
      resizeOptions: { background: '#1a1a2e' },
    },
  },
  images: ['public/pwa-icon.svg'],
})
