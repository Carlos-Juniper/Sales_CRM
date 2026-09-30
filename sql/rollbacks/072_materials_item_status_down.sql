-- ---------------------------------------------------------------------------
-- Rollback for 072_materials_item_status.sql
--
-- scripts/migrate.py does not run files outside sql/migrations/. Apply by
-- hand, after reverting scripts/materials_store.py to a version that writes
-- active:
--
--   mysql ... crm < sql/rollbacks/072_materials_item_status_down.sql
--
-- Restores the plain 070 active column (1 where item_status is 'Active',
-- else 0; statuses such as 'No Purchases' become 0), drops item_status, and
-- deletes this file's schema_migrations row. Guarded and idempotent.
-- ---------------------------------------------------------------------------

SET @r_active_generated = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
       AND COLUMN_NAME = 'active' AND UPPER(EXTRA) LIKE '%GENERATED%'
);

SET @r_drop_idx = IF(
    @r_active_generated = 0
    OR (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
           AND INDEX_NAME = 'idx_materials_bid_active') = 0,
    'SELECT 1',
    'ALTER TABLE materials DROP INDEX idx_materials_bid_active'
);
PREPARE stmt_r_drop_idx FROM @r_drop_idx;
EXECUTE stmt_r_drop_idx;
DEALLOCATE PREPARE stmt_r_drop_idx;

SET @r_drop_active = IF(
    @r_active_generated = 0,
    'SELECT 1',
    'ALTER TABLE materials DROP COLUMN active'
);
PREPARE stmt_r_drop_active FROM @r_drop_active;
EXECUTE stmt_r_drop_active;
DEALLOCATE PREPARE stmt_r_drop_active;

SET @r_add_active = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
        AND COLUMN_NAME = 'active') > 0,
    'SELECT 1',
    'ALTER TABLE materials ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER available_to_bid'
);
PREPARE stmt_r_add_active FROM @r_add_active;
EXECUTE stmt_r_add_active;
DEALLOCATE PREPARE stmt_r_add_active;

SET @r_backfill = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
        AND COLUMN_NAME = 'item_status') = 0,
    'SELECT 1',
    'UPDATE materials SET active = (item_status = ''Active'')'
);
PREPARE stmt_r_backfill FROM @r_backfill;
EXECUTE stmt_r_backfill;
DEALLOCATE PREPARE stmt_r_backfill;

SET @r_add_idx = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
        AND INDEX_NAME = 'idx_materials_bid_active') > 0,
    'SELECT 1',
    'ALTER TABLE materials ADD INDEX idx_materials_bid_active (available_to_bid, active)'
);
PREPARE stmt_r_add_idx FROM @r_add_idx;
EXECUTE stmt_r_add_idx;
DEALLOCATE PREPARE stmt_r_add_idx;

SET @r_drop_status = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials'
        AND COLUMN_NAME = 'item_status') = 0,
    'SELECT 1',
    'ALTER TABLE materials DROP COLUMN item_status'
);
PREPARE stmt_r_drop_status FROM @r_drop_status;
EXECUTE stmt_r_drop_status;
DEALLOCATE PREPARE stmt_r_drop_status;

SET @r_clear_072 = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'
        AND COLUMN_NAME = 'id') = 0,
    'SELECT 1',
    'DELETE FROM schema_migrations WHERE id = ''072_materials_item_status'''
);
PREPARE stmt_r_clear_072 FROM @r_clear_072;
EXECUTE stmt_r_clear_072;
DEALLOCATE PREPARE stmt_r_clear_072;
