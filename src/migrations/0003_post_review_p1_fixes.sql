-- Costco TW Price Match — P1 batch (#24, #26, #28)
--
-- Why
--   1. notifications_log: dedup currently inspects json_extract(payload, '$._dedup'),
--      which is slow and indexable only via FTS-style trickery. Promote dedup_key
--      to a first-class column with an index.
--   2. subscriptions: existing UNIQUE(user_id, type, product_code) treats two
--      NULL product_code rows as distinct, so global subscriptions
--      (new_onsale / new_best_buy) can be inserted twice. Add a partial UNIQUE
--      index covering the NULL case so SQLite enforces "one global subscription
--      per (user, type)" while keeping per-product subscriptions distinct.
--      Existing duplicate global rows are deduped first.

-- 1. notifications_log: dedup_key column + index
ALTER TABLE notifications_log ADD COLUMN dedup_key TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_user_dedup
  ON notifications_log (user_id, dedup_key);

-- 2. subscriptions: dedup global rows then add partial UNIQUE
DELETE FROM subscriptions
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM subscriptions
  GROUP BY user_id, type, COALESCE(product_code, '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_global
  ON subscriptions (user_id, type)
  WHERE product_code IS NULL;
