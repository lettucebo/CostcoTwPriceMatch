-- Costco TW Price Match — initial schema
-- Run with: wrangler d1 migrations apply DB

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  picture TEXT,
  notification_email TEXT,
  notification_channels TEXT NOT NULL DEFAULT '["email"]',
  line_user_id TEXT,
  telegram_chat_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);

CREATE TABLE IF NOT EXISTS products (
  code TEXT PRIMARY KEY,
  zh_name TEXT NOT NULL,
  en_name TEXT,
  current_price REAL NOT NULL,
  base_price REAL,
  discount_price REAL,
  unit_price REAL,
  unit_type TEXT,
  url TEXT NOT NULL,
  image_url TEXT,
  delivery_name TEXT,
  in_stock INTEGER NOT NULL DEFAULT 1,
  stock_level INTEGER,
  raw_json TEXT NOT NULL,
  last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_last_checked ON products (last_checked_at);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  price REAL NOT NULL,
  base_price REAL,
  discount_price REAL,
  in_stock INTEGER NOT NULL DEFAULT 1,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_code) REFERENCES products (code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_price_history_product_observed
  ON price_history (product_code, observed_at DESC);

CREATE TABLE IF NOT EXISTS daily_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  product_code TEXT NOT NULL,
  price REAL NOT NULL,
  has_discount INTEGER NOT NULL DEFAULT 0,
  in_stock INTEGER NOT NULL DEFAULT 1,
  UNIQUE (snapshot_date, product_code),
  FOREIGN KEY (product_code) REFERENCES products (code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date ON daily_snapshots (snapshot_date);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_code TEXT NOT NULL,
  purchase_price REAL NOT NULL,
  purchase_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, product_code, purchase_date),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (product_code) REFERENCES products (code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_watchlist_user_status
  ON watchlist_items (user_id, status);
CREATE INDEX IF NOT EXISTS idx_watchlist_product
  ON watchlist_items (product_code);

CREATE TABLE IF NOT EXISTS notifications_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  watchlist_item_id INTEGER,
  channel TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_item_id) REFERENCES watchlist_items (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_sent
  ON notifications_log (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_dedup
  ON notifications_log (user_id, watchlist_item_id, channel);

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  target TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_started
  ON scrape_jobs (started_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  product_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, type, product_code),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_type ON subscriptions (type);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id);
