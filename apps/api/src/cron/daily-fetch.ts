// Filled in issue #5
import type { Env } from '../env.js'

export interface DailyFetchOptions {
  trigger: 'cron' | 'manual'
  cron?: string
}

export interface DailyFetchResult {
  ok: boolean
  fetched: number
  errors: number
  trigger: string
  duration_ms: number
}

export async function runDailyFetch(
  env: Env,
  opts: DailyFetchOptions,
): Promise<DailyFetchResult> {
  return {
    ok: false,
    fetched: 0,
    errors: 0,
    trigger: opts.trigger,
    duration_ms: 0,
  }
}
