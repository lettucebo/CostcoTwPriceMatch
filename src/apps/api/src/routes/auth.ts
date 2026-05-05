import { Hono } from 'hono'
import type { AppContext } from '../env.js'

export const authRouter = new Hono<AppContext>()

// Implementations live in ./auth/google.ts (filled by issue #3)
import { googleLoginRoute, googleCallbackRoute, logoutRoute } from '../auth/google.js'

authRouter.get('/google/login', googleLoginRoute)
authRouter.get('/google/callback', googleCallbackRoute)
authRouter.post('/logout', logoutRoute)
