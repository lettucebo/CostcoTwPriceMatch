// Filled in issue #6
import type { Env } from '../env.js'

export interface PriceMatchResult {
  eligible: number
  notifications: number
}

export async function runPriceMatch(env: Env): Promise<PriceMatchResult> {
  return { eligible: 0, notifications: 0 }
}
