---
applyTo: "migrations/**/*.sql"
description: "Use when adding or editing D1 SQL migrations under migrations/. Enforces the project's schema conventions: filename ordering, idempotent DDL, foreign keys, indexes, datetime defaults, and the 'no destructive prod migration' rule."
---

# D1 Migration Checklist

Before saving any new file under [`migrations/`](../../migrations/), confirm every item below.

## Filename

- Format: `NNNN_short_description.sql` — 4-digit zero-padded prefix, snake_case description.
- The number must be **strictly greater** than every existing file. Check with:
  ```bash
  Get-ChildItem migrations/*.sql | Sort-Object Name | Select-Object -Last 1
  ```
- One purpose per migration; do not pack unrelated changes together.

## DDL conventions (match [`0001_initial.sql`](../../migrations/0001_initial.sql))

- **Idempotent**: every statement uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Never bare `CREATE`.
- **Primary key**: `INTEGER PRIMARY KEY AUTOINCREMENT` for surrogate ids; otherwise the natural key as `TEXT PRIMARY KEY` (e.g., `products.code`).
- **Booleans**: D1 / SQLite has no real bool — use `INTEGER NOT NULL DEFAULT 0|1` and surface as `0 | 1` in the matching `*Row` interface.
- **Timestamps**: `TEXT NOT NULL DEFAULT (datetime('now'))`. Always **UTC**, ISO-8601 format. Never use `CURRENT_TIMESTAMP` (subtly different).
- **JSON columns**: store as `TEXT NOT NULL`. Validate / serialize at the application layer, not in SQL.
- **Foreign keys**: always declare with `ON DELETE CASCADE` so user / product deletes cleanly cascade. SQLite's PRAGMA foreign_keys is on by default in D1.
- **Uniqueness**: prefer `UNIQUE (col_a, col_b)` table-level constraints over separate unique indexes.
- **Indexes**: index every FK and every column used in `WHERE` of hot queries (cron, dashboard listing, dedup lookups). Name them `idx_<table>_<cols>`.

## Type alignment

- For every table you add or modify, **also update the matching `*Row` interface** in [`packages/shared/src/types.ts`](../../packages/shared/src/types.ts).
- Keep column order, nullability, and `0 | 1` literal types consistent — the rest of the codebase uses `db.prepare(...).first<UserRow>()` style and silently mistypes if the interface drifts.

## Production safety

- **Additive only by default**. Avoid `DROP TABLE`, `DROP COLUMN`, `ALTER TABLE ... DROP`, or any rename in remote production runs.
  - SQLite cannot drop a column without rebuilding the table; if you really need it, write the multi-step idiom (rename → create new → copy → drop) inside a single migration with `BEGIN/COMMIT`.
- Never `DELETE FROM` real data inside a migration. Cleanups belong in a one-off Worker route guarded by `INTERNAL_BEARER`.
- Migrations run **once** per environment. If you push a fix, write a new migration that supersedes the broken one — do not edit the original file once it has been applied to remote.

## Verify locally before commit

Run all three; the migration is not done until they all pass:

```bash
pnpm --filter @costco/api run db:migrate:local      # apply migrations
pnpm --filter @costco/api run db:tables             # list tables — sanity check the new ones appear
pnpm --filter @costco/api run typecheck             # confirm *Row interfaces match
```

## Apply to production

```bash
pnpm --filter @costco/api run db:migrate:remote
```

This is **idempotent** thanks to `IF NOT EXISTS`, but Wrangler tracks applied filenames in `d1_migrations`. If a migration fails halfway, fix the SQL and re-run; do **not** rename the file (Wrangler will then think it's a new migration).

## Anti-patterns to reject

- ❌ `CREATE TABLE foo (...)` without `IF NOT EXISTS`.
- ❌ `created_at DATETIME DEFAULT CURRENT_TIMESTAMP` — use TEXT + `datetime('now')` for full ISO-8601 with TZ-aware behavior.
- ❌ `BOOLEAN`, `BIGINT`, `JSON` types — D1 ignores them; pick `INTEGER` / `TEXT`.
- ❌ Adding a column without updating the matching `*Row` interface in `packages/shared/src/types.ts`.
- ❌ Editing an already-applied migration file. Always add a new one (`0003_*.sql`).
- ❌ Putting `INSERT INTO ... seed data` for non-test environments. Seeds belong in a script under `apps/api/scripts/`.
