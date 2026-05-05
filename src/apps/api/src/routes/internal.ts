import { Hono } from 'hono'
import type { AppContext } from '../env.js'
import { runDailyFetch } from '../cron/daily-fetch.js'

export const internalRouter = new Hono<AppContext>()

/** Bearer secret guard for cron-like endpoints. */
internalRouter.use('*', async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  const expected = `Bearer ${c.env.INTERNAL_BEARER}`
  if (auth !== expected) return c.json({ error: 'unauthorized' }, 401)
  await next()
})

internalRouter.post('/cron/daily-fetch', async (c) => {
  const result = await runDailyFetch(c.env, { trigger: 'manual' })
  return c.json(result)
})
