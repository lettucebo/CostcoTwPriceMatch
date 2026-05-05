import type {
  NotificationChannel,
  SubscriptionType,
  WatchlistStatus,
} from './constants.js'

/** D1 row: users */
export interface UserRow {
  id: number
  google_sub: string
  email: string
  name: string | null
  picture: string | null
  notification_email: string | null
  notification_channels: string // JSON
  line_user_id: string | null
  telegram_chat_id: string | null
  created_at: string
  updated_at: string
}

/** D1 row: products */
export interface ProductRow {
  code: string
  zh_name: string
  en_name: string | null
  current_price: number
  base_price: number | null
  discount_price: number | null
  unit_price: number | null
  unit_type: string | null
  url: string
  image_url: string | null
  delivery_name: string | null
  in_stock: 0 | 1
  stock_level: number | null
  raw_json: string
  last_checked_at: string
  created_at: string
}

/** D1 row: price_history */
export interface PriceHistoryRow {
  id: number
  product_code: string
  price: number
  base_price: number | null
  discount_price: number | null
  in_stock: 0 | 1
  observed_at: string
}

/** D1 row: daily_snapshots */
export interface DailySnapshotRow {
  id: number
  snapshot_date: string // YYYY-MM-DD
  product_code: string
  price: number
  has_discount: 0 | 1
  in_stock: 0 | 1
}

/** D1 row: watchlist_items */
export interface WatchlistItemRow {
  id: number
  user_id: number
  product_code: string
  purchase_price: number
  purchase_date: string // YYYY-MM-DD
  status: WatchlistStatus
  notes: string | null
  created_at: string
  updated_at: string
}

/** D1 row: notifications_log */
export interface NotificationLogRow {
  id: number
  user_id: number
  watchlist_item_id: number | null
  channel: NotificationChannel
  payload: string // JSON
  status: 'sent' | 'failed' | 'skipped'
  error: string | null
  sent_at: string
}

/** D1 row: scrape_jobs */
export interface ScrapeJobRow {
  id: number
  type: string
  target: string | null
  status: 'pending' | 'running' | 'success' | 'failed'
  started_at: string | null
  finished_at: string | null
  error: string | null
  meta: string | null // JSON
}

/** D1 row: subscriptions */
export interface SubscriptionRow {
  id: number
  user_id: number
  type: SubscriptionType
  product_code: string | null // restock 才有
  created_at: string
}

/** D1 row: push_subscriptions */
export interface PushSubscriptionRow {
  id: number
  user_id: number
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

/** API: watchlist item with computed fields */
export interface WatchlistItemView {
  id: number
  product: {
    code: string
    zh_name: string
    en_name: string | null
    current_price: number
    base_price: number | null
    discount_price: number | null
    url: string
    image_url: string | null
    in_stock: boolean
    last_checked_at: string
  }
  purchase_price: number
  purchase_date: string
  status: WatchlistStatus
  notes: string | null
  /** purchase_price - current_price; positive means user can claim refund */
  price_diff: number
  /** 30 - days_since_purchase; <=0 means expired */
  days_remaining: number
  is_eligible: boolean
  created_at: string
}

/** Auth: JWT payload we sign */
export interface JwtPayload {
  sub: string // user id (number as string)
  email: string
  name: string | null
  picture: string | null
  iat: number
  exp: number
}

/** Notification dispatch payload */
export interface NotifyPayload {
  kind: 'price_match' | 'new_onsale_digest' | 'restock' | 'new_best_buy_digest'
  title: string
  body: string
  url?: string
  items?: Array<{
    code: string
    name: string
    image_url: string | null
    purchase_price?: number
    current_price: number
    base_price?: number | null
    diff?: number
    days_remaining?: number
  }>
}
