// Filled in issue #3
import type { Context } from 'hono'
import type { AppContext } from '../env.js'

export async function googleLoginRoute(c: Context<AppContext>) {
  return c.json({ todo: 'issue #3' }, 501)
}
export async function googleCallbackRoute(c: Context<AppContext>) {
  return c.json({ todo: 'issue #3' }, 501)
}
export async function logoutRoute(c: Context<AppContext>) {
  return c.json({ todo: 'issue #3' }, 501)
}
