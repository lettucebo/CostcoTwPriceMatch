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
  TELEGRAM_BOT_TOKEN?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

export interface AppVariables {
  userId: number
}

export type AppContext = {
  Bindings: Env
  Variables: AppVariables
}
