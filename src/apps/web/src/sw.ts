/// <reference lib="WebWorker" />
/// <reference types="vite-plugin-pwa/info" />

import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import {
  StaleWhileRevalidate,
  NetworkFirst,
  CacheFirst,
} from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// SPA fallback for navigation, except API/auth.
//
// Workbox version-stamps its precache (e.g. `workbox-precache-v2-...`), so the
// previous implementation that did `caches.open('workbox-precache').match(...)`
// was always a miss. `createHandlerBoundToURL` resolves the actual revisioned
// URL via the manifest at install time, so the handler returns the correct
// cached `/index.html` regardless of cache name.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/auth\//],
  }),
)

// Product detail data — SWR
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/products/'),
  new StaleWhileRevalidate({
    cacheName: 'api-products',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

// Watchlist — network first
registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith('/api/watchlist') && request.method === 'GET',
  new NetworkFirst({
    cacheName: 'api-watchlist',
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

// Images — cache first 30d
registerRoute(
  ({ request }) =>
    request.destination === 'image' ||
    /\.(?:png|jpg|jpeg|webp|svg)$/.test(request.url),
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

// Google Fonts
registerRoute(
  /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 365 * 24 * 60 * 60,
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  }),
)

// ---- Push notifications ----

self.addEventListener('push', (event) => {
  const ev = event as PushEvent
  let data: {
    title?: string
    body?: string
    url?: string
    item?: {
      code: string
      name: string
      image_url: string | null
      current_price: number
    }
  } = {}
  try {
    data = ev.data?.json() ?? {}
  } catch {
    data = { body: ev.data?.text() }
  }
  const title = data.title || 'CostcoMatch 通知'
  const options: NotificationOptions = {
    body: data.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: data.url || '/' },
    tag: data.item?.code,
  }
  // Some properties (image, actions) aren't standard but useful where supported.
  if (data.item?.image_url) {
    ;(options as Notification & { image?: string }).image = data.item.image_url
  }
  ev.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  const ev = event as NotificationEvent
  ev.notification.close()
  const url =
    (ev.notification.data as { url?: string } | undefined)?.url ?? '/'
  ev.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const c of all) {
        if (c.url.startsWith(self.registration.scope)) {
          await c.focus()
          await (c as WindowClient).navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})

self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  ;(event as ExtendableEvent).waitUntil(self.clients.claim())
})

export {}
