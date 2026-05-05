import { Hono } from 'hono'
import type { AppContext } from '../env.js'
import { requireAuth } from '../auth/middleware.js'
import { scanReceipt, confirmReceipt } from '../services/receipts.js'

export const receiptsRouter = new Hono<AppContext>()

receiptsRouter.use('*', requireAuth)

receiptsRouter.post('/scan', scanReceipt)
receiptsRouter.post('/confirm', confirmReceipt)
