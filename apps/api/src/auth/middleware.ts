import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppContext } from '../env.js'
import { verifySessionJwt } from './jwt.js'
import { SESSION_COOKIE } from './google.js'

/**
 * Resolve the current user id from the session cookie.
 * Returns null if no valid session — caller decides whether to 401.
 */
export async function tryGetUserId(
  c: Parameters<MiddlewareHandler<AppContext>>[0],
): Promise<number | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  try {
    const payload = await verifySessionJwt(token, c.env.JWT_SECRET)
    const id = Number(payload.sub)
    if (!Number.isFinite(id) || id <= 0) return null
    return id
  } catch {
    return null
  }
}

export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const userId = await tryGetUserId(c)
  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  c.set('userId', userId)
  await next()
}
