export const PRICE_MATCH_DAYS = 30

export const NOTIFICATION_CHANNELS = ['email', 'line', 'telegram', 'webpush'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const WATCHLIST_STATUSES = [
  'active',
  'price_match_eligible',
  'expired',
  'claimed',
] as const
export type WatchlistStatus = (typeof WATCHLIST_STATUSES)[number]

export const SUBSCRIPTION_TYPES = [
  'new_onsale', // 新進特價
  'new_best_buy', // 價尾 7 經理特價
  'restock', // 補貨
] as const
export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number]

export const COSTCO_TW_BASE = 'https://www.costco.com.tw'
export const COSTCO_TW_API_BASE = 'https://www.costco.com.tw/rest/v2/taiwan'
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 CostcoTwPriceMatch/1.0 (personal use)'
