// Filled in issue #8
import type { Env } from '../env.js'

export interface SnapshotDiffResult {
  events: number
}

export async function runSnapshotDiff(
  env: Env,
  today: string,
): Promise<SnapshotDiffResult> {
  return { events: 0 }
}
