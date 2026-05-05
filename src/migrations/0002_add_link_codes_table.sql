-- Costco TW Price Match — link codes for LINE / Telegram channel verification
-- Required by #21: previously /api/me/link/* trusted client-supplied IDs.
-- The new flow:
--   1. User hits POST /api/me/link/<channel>/start  → server inserts a code here.
--   2. User sends the code to the bot (LINE) or types /start <code> (Telegram).
--   3. The bot's webhook claims the code atomically and sets users.<channel>_id.
-- Codes expire after 10 minutes.

CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('line', 'telegram')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Only one pending code per (user, channel). New POST /link/<ch>/start replaces
  -- the prior code via INSERT ... ON CONFLICT(user_id, channel) DO UPDATE.
  UNIQUE (user_id, channel),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_link_codes_expires
  ON link_codes (expires_at);
