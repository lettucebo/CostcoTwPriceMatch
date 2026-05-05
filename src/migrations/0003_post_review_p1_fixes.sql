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

-- 2. subscriptions: dedup duplicate global rows (product_code IS NULL only),
--    then add the partial UNIQUE index. Per-product rows already had a working
--    UNIQUE(user_id, type, product_code) and don't need cleanup.
--
--    DELETE is scoped narrowly:
--      - only rows where product_code IS NULL (the buggy case)
--      - keep the earliest-created row in each (user_id, type) group, which is
--        a stable user-meaningful column (rather than rowid which is an
--        implementation detail).
DELETE FROM subscriptions
WHERE product_code IS NULL
  AND id NOT IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, type
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM subscriptions
      WHERE product_code IS NULL
    )
    WHERE rn = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_global
  ON subscriptions (user_id, type)
  WHERE product_code IS NULL;
