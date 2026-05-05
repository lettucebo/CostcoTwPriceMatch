// Filled in issue #3 — for now, returns 401 unconditionally so dependent routes don't accidentally pass without auth.
import type { MiddlewareHandler } from 'hono'
import type { AppContext } from '../env.js'

export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  return c.json({ error: 'auth_not_implemented' }, 501)
}
