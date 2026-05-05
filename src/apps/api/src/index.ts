import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { AppContext, Env } from './env.js'
import { authRouter } from './routes/auth.js'
import { meRouter } from './routes/me.js'
import { watchlistRouter } from './routes/watchlist.js'
import { productsRouter } from './routes/products.js'
import { receiptsRouter } from './routes/receipts.js'
import { subscriptionsRouter } from './routes/subscriptions.js'
import { pushRouter } from './routes/push.js'
import { internalRouter } from './routes/internal.js'
import { webhookRouter } from './routes/webhook.js'
import { runDailyFetch } from './cron/daily-fetch.js'

const app = new Hono<AppContext>()

app.use(logger())
app.use(secureHeaders())
// CORS must apply to /auth/* (cross-origin POST /auth/logout from Pages → Workers)
// as well as /api/*. Mounting at root catches both.
app.use('*', (c, next) => {
  const origin = c.env.APP_BASE_URL
  return cors({
    origin: [origin, 'http://localhost:5173'],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next)
})

app.get('/api/health', (c) =>
  c.json({ ok: true, ts: new Date().toISOString() }),
)

app.route('/auth', authRouter)
app.route('/webhook', webhookRouter)
app.route('/api/me', meRouter)
app.route('/api/watchlist', watchlistRouter)
app.route('/api/products', productsRouter)
app.route('/api/receipts', receiptsRouter)
app.route('/api/subscriptions', subscriptionsRouter)
app.route('/api/push', pushRouter)
app.route('/api/internal', internalRouter)

app.onError((err, c) => {
  console.error('[unhandled]', err)
  return c.json({ error: 'internal_error', message: err.message }, 500)
})

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runDailyFetch(env, { trigger: 'cron', cron: event.cron }))
  },
}
