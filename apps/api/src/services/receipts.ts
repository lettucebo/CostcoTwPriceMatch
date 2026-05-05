// Filled in issue #10
import type { Context } from 'hono'
import type { AppContext } from '../env.js'

const todo = (c: Context<AppContext>) => c.json({ todo: 'issue #10' }, 501)

export const scanReceipt = todo
export const confirmReceipt = todo
