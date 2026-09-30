-- ---------------------------------------------------------------------------
-- Migration 072 — materials.item_status (Acumatica ItemStatus).
--
-- Numbered 072 because open PR #53 uses 071 (item_classes).
--
-- The stock item list (scripts/data/acumatica_stock_items.xlsx) and the
-- Acumatica StockItem entity carry ItemStatus: Active, Inactive, No Sales,
-- No Purchases, No Request, Marked for Deletion. 070 stored only a boolean
-- active, which cannot tell "No Purchases" from "Inactive". This file:
--
--   1. adds item_status VARCHAR(32) (the status as the source gives it),
--   2. backfills it from active (1 -> 'Active', 0 -> 'Inactive'),
--   3. makes it NOT NULL DEFAULT 'Active',
--   4. replaces active with a STORED generated column
--      (item_status = 'Active'; the column collation is case-insensitive),
--      so the two can never disagree, and re-adds idx_materials_bid_active.
--
-- Readers of materials.active keep working. Writers must stop writing
-- active (scripts/materials_store.py writes item_status).
--
-- Re-runnable: every step is guarded on information_schema, so a partial
-- run finishes on the next run. Detector: scripts/migrate.py detect_072.
-- Rollback (not applied by the runner):
-- sql/rollbacks/072_materials_item_status_down.sql
-- ---------------------------------------------------------------------------

-- 1. item_status column (nullable until backfilled).
SET @m_add_status = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
        AND COLUMN_NAME = 'item_status') > 0,
    'SELECT 1',
    'ALTER TABLE materials ADD COLUMN item_status VARCHAR(32) DEFAULT NULL AFTER vendor_sku'
);
PREPARE stmt_m_add_status FROM @m_add_status;
EXECUTE stmt_m_add_status;
DEALLOCATE PREPARE stmt_m_add_status;

-- Is active still the plain 070 column?
SET @m_active_plain = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
       AND COLUMN_NAME = 'active' AND UPPER(EXTRA) NOT LIKE '%GENERATED%'
);

-- 2. Backfill from the plain active column.
SET @m_backfill = IF(
    @m_active_plain = 0,
    'SELECT 1',
    'UPDATE materials SET item_status = IF(active = 1, ''Active'', ''Inactive'') WHERE item_status IS NULL'
);
PREPARE stmt_m_backfill FROM @m_backfill;
EXECUTE stmt_m_backfill;
DEALLOCATE PREPARE stmt_m_backfill;

-- 3. NOT NULL DEFAULT 'Active'.
SET @m_status_not_null = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
        AND COLUMN_NAME = 'item_status' AND IS_NULLABLE = 'YES') = 0,
    'SELECT 1',
    'ALTER TABLE materials MODIFY COLUMN item_status VARCHAR(32) NOT NULL DEFAULT ''Active'''
);
PREPARE stmt_m_status_not_null FROM @m_status_not_null;
EXECUTE stmt_m_status_not_null;
DEALLOCATE PREPARE stmt_m_status_not_null;

-- 4a. Drop the index over the plain active column.
SET @m_drop_idx = IF(
    @m_active_plain = 0
    OR (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
           AND INDEX_NAME = 'idx_materials_bid_active') = 0,
    'SELECT 1',
    'ALTER TABLE materials DROP INDEX idx_materials_bid_active'
);
PREPARE stmt_m_drop_idx FROM @m_drop_idx;
EXECUTE stmt_m_drop_idx;
DEALLOCATE PREPARE stmt_m_drop_idx;

-- 4b. Drop the plain active column.
SET @m_drop_active = IF(
    @m_active_plain = 0,
    'SELECT 1',
    'ALTER TABLE materials DROP COLUMN active'
);
PREPARE stmt_m_drop_active FROM @m_drop_active;
EXECUTE stmt_m_drop_active;
DEALLOCATE PREPARE stmt_m_drop_active;

-- 4c. Generated active.
SET @m_add_active = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
        AND COLUMN_NAME = 'active') > 0,
    'SELECT 1',
    'ALTER TABLE materials ADD COLUMN active TINYINT(1) GENERATED ALWAYS AS (item_status = ''Active'') STORED NOT NULL AFTER available_to_bid'
);
PREPARE stmt_m_add_active FROM @m_add_active;
EXECUTE stmt_m_add_active;
DEALLOCATE PREPARE stmt_m_add_active;

-- 4d. Index over (available_to_bid, active).
SET @m_add_idx = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
        AND INDEX_NAME = 'idx_materials_bid_active') > 0,
    'SELECT 1',
    'ALTER TABLE materials ADD INDEX idx_materials_bid_active (available_to_bid, active)'
);
PREPARE stmt_m_add_idx FROM @m_add_idx;
EXECUTE stmt_m_add_idx;
DEALLOCATE PREPARE stmt_m_add_idx;
