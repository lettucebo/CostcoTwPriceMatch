/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Costco TW 退差價追蹤',
        short_name: 'CostcoMatch',
        description:
          '追蹤 Costco 台灣商品價格，自動偵測 30 天內降價並提醒申請退差價',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        lang: 'zh-Hant-TW',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
  build: {
    // Split heavy / rarely-changing libraries into their own chunks so the
    // main bundle stays small. The previous single-bundle build was ~620 KB
    // (180 KB gz); after splitting the dashboard-relevant code is well under
    // the 500 KB warning threshold.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          recharts: ['recharts'],
        },
      },
    },
    // Recharts itself is ~380 KB; the rest of our chunks are small. 450 catches
    // any future regression on the *main* bundle without flagging the lazy
    // recharts chunk on every build.
    chunkSizeWarningLimit: 450,
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
  },
})
