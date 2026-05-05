import { Hono } from 'hono'
import type { AppContext } from '../env.js'

// Implementations live in ../services and are wired here for issue #4
import {
  listWatchlist,
  createWatchlistItem,
  getWatchlistItem,
  updateWatchlistItem,
  deleteWatchlistItem,
  refreshWatchlistItem,
} from '../services/watchlist.js'
import { requireAuth } from '../auth/middleware.js'

export const watchlistRouter = new Hono<AppContext>()

watchlistRouter.use('*', requireAuth)

watchlistRouter.get('/', listWatchlist)
watchlistRouter.post('/', createWatchlistItem)
watchlistRouter.get('/:id', getWatchlistItem)
watchlistRouter.patch('/:id', updateWatchlistItem)
watchlistRouter.delete('/:id', deleteWatchlistItem)
watchlistRouter.post('/:id/refresh', refreshWatchlistItem)
