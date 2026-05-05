import type { Env } from '../env.js'
import type { NotifyPayload, UserRow, NotificationChannel } from '@costco/shared'

export interface NotifyResult {
  channel: NotificationChannel
  status: 'sent' | 'failed' | 'skipped'
  error?: string
}

export interface NotifierContext {
  user: UserRow
  payload: NotifyPayload
  watchlistItemId?: number
}

export interface Notifier {
  channel: NotificationChannel
  isEnabled(env: Env, ctx: NotifierContext): boolean
  send(env: Env, ctx: NotifierContext): Promise<NotifyResult>
}
