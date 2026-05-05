/// <reference types="@cloudflare/workers-types" />

import type { D1Database, KVNamespace, Ai } from '@cloudflare/workers-types'

export interface Env {
  // Bindings
  DB: D1Database
  KV_CACHE: KVNamespace
  AI: Ai

  // Vars (public, in wrangler.jsonc)
  APP_BASE_URL: string
  API_BASE_URL: string

  // Secrets (set via `wrangler secret put`)
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  JWT_SECRET: string
  RESEND_API_KEY?: string
  INTERNAL_BEARER: string
  LINE_CHANNEL_ACCESS_TOKEN?: string
  /** LINE Messaging API channel secret — required to verify webhook signatures. */
  LINE_CHANNEL_SECRET?: string
  TELEGRAM_BOT_TOKEN?: string
  /** Token used as `X-Telegram-Bot-Api-Secret-Token` header to authenticate Telegram webhooks. */
  TELEGRAM_WEBHOOK_SECRET?: string
  /** Telegram bot username (without @), used to build deep-link `https://t.me/<bot>?start=<code>`. */
  TELEGRAM_BOT_USERNAME?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  /**
   * Email address that receives operational alerts (cron failures, fetch
   * errors above threshold). Optional — if unset, alerts are logged only.
   */
  ADMIN_ALERT_EMAIL?: string
  /**
   * Cron error count above which we send an alert email to ADMIN_ALERT_EMAIL.
   * Default 5. Set to "0" to disable alerts entirely. Stored as string because
   * Worker `vars` are always strings.
   */
  CRON_ALERT_THRESHOLD?: string
}

export interface AppVariables {
  userId: number
}

export type AppContext = {
  Bindings: Env
  Variables: AppVariables
}
