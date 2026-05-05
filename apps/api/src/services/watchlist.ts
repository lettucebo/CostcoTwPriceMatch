// Filled in issue #4
import type { Context } from 'hono'
import type { AppContext } from '../env.js'

const todo = (c: Context<AppContext>) => c.json({ todo: 'issue #4' }, 501)

export const listWatchlist = todo
export const createWatchlistItem = todo
export const getWatchlistItem = todo
export const updateWatchlistItem = todo
export const deleteWatchlistItem = todo
export const refreshWatchlistItem = todo
