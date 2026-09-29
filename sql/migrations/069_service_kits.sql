-- ---------------------------------------------------------------------------
-- Migration 069 — rename the kit catalog from catalog_items to service_kits.
--
-- Numbered 069 after checking open pull requests: 065 is the commission
-- cadence migration (PR 40), 067 and 068 are the sales-role migrations
-- (PR 39), and 066 is unused. 070 is the materials catalog on the stacked
-- branch. A duplicate number is silently skipped by scripts/migrate.py.
--
-- The priced service-kit table catalog_items becomes service_kits.
-- section_services.catalog_item_id and takeoff_lines.catalog_item_id
-- become service_kit_id and reference service_kits.
--
-- Dev vs prod, both must succeed:
--   * Prod has takeoff_lines.fk_takeoff_catalog_item (ON DELETE SET NULL).
--     Dev does not. section_services has the kit FK on both.
--   * This file drops whichever of those FKs exist, then adds
--     fk_services_service_kit and fk_takeoff_service_kit on both
--     environments. takeoff_lines is empty on dev and prod, and dev's
--     section_services rows have no orphan kit ids, so the new FKs hold.
--   * Cosmetic charset differences are left on the renamed table. RENAME
--     keeps the existing rows, indexes, and column definitions.
--
-- Detectors for 008, 009, and 044 also understand the new names so a
-- database that already ran 069 is not mistaken for one that never seeded
-- kits. The historical SQL files themselves are unchanged: on a fresh
-- database they run while the table is still called catalog_items.
--
-- Rollback (not applied by the runner): sql/rollbacks/069_service_kits_down.sql
-- The runner has no down path. That file is outside sql/migrations/ so
-- migrate.py will not execute it. The rollback also deletes this file's
-- schema_migrations row.
--
-- Every statement is information_schema-guarded. Re-running after a
-- partial apply finishes the remainder.
-- ---------------------------------------------------------------------------

-- ── 1. Drop kit FKs that would block the column rename ─────────────────────
-- Names differ (and the takeoff FK is absent on dev), so look them up.
-- Repeat so a second constraint on the same column is dropped too.

SET @fk_services_1 = (
    SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'section_services'
       AND COLUMN_NAME IN ('catalog_item_id', 'service_kit_id')
       AND REFERENCED_TABLE_NAME IS NOT NULL
     LIMIT 1
);
SET @drop_fk_services_1 = IF(
    @fk_services_1 IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE section_services DROP FOREIGN KEY `', @fk_services_1, '`')
);
PREPARE stmt_drop_fk_services_1 FROM @drop_fk_services_1;
EXECUTE stmt_drop_fk_services_1;
DEALLOCATE PREPARE stmt_drop_fk_services_1;

SET @fk_services_2 = (
    SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'section_services'
       AND COLUMN_NAME IN ('catalog_item_id', 'service_kit_id')
       AND REFERENCED_TABLE_NAME IS NOT NULL
     LIMIT 1
);
SET @drop_fk_services_2 = IF(
    @fk_services_2 IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE section_services DROP FOREIGN KEY `', @fk_services_2, '`')
);
PREPARE stmt_drop_fk_services_2 FROM @drop_fk_services_2;
EXECUTE stmt_drop_fk_services_2;
DEALLOCATE PREPARE stmt_drop_fk_services_2;

SET @fk_takeoff_1 = (
    SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'takeoff_lines'
       AND COLUMN_NAME IN ('catalog_item_id', 'service_kit_id')
       AND REFERENCED_TABLE_NAME IS NOT NULL
     LIMIT 1
);
SET @drop_fk_takeoff_1 = IF(
    @fk_takeoff_1 IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE takeoff_lines DROP FOREIGN KEY `', @fk_takeoff_1, '`')
);
PREPARE stmt_drop_fk_takeoff_1 FROM @drop_fk_takeoff_1;
EXECUTE stmt_drop_fk_takeoff_1;
DEALLOCATE PREPARE stmt_drop_fk_takeoff_1;

SET @fk_takeoff_2 = (
    SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'takeoff_lines'
       AND COLUMN_NAME IN ('catalog_item_id', 'service_kit_id')
       AND REFERENCED_TABLE_NAME IS NOT NULL
     LIMIT 1
);
SET @drop_fk_takeoff_2 = IF(
    @fk_takeoff_2 IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE takeoff_lines DROP FOREIGN KEY `', @fk_takeoff_2, '`')
);
PREPARE stmt_drop_fk_takeoff_2 FROM @drop_fk_takeoff_2;
EXECUTE stmt_drop_fk_takeoff_2;
DEALLOCATE PREPARE stmt_drop_fk_takeoff_2;

-- ── 2. Rename the referencing columns ──────────────────────────────────────

SET @rename_services_col = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'section_services'
        AND COLUMN_NAME = 'catalog_item_id') = 0,
    'SELECT 1',
    'ALTER TABLE section_services RENAME COLUMN catalog_item_id TO service_kit_id'
);
PREPARE stmt_rename_services_col FROM @rename_services_col;
EXECUTE stmt_rename_services_col;
DEALLOCATE PREPARE stmt_rename_services_col;

SET @rename_takeoff_col = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'takeoff_lines'
        AND COLUMN_NAME = 'catalog_item_id') = 0,
    'SELECT 1',
    'ALTER TABLE takeoff_lines RENAME COLUMN catalog_item_id TO service_kit_id'
);
PREPARE stmt_rename_takeoff_col FROM @rename_takeoff_col;
EXECUTE stmt_rename_takeoff_col;
DEALLOCATE PREPARE stmt_rename_takeoff_col;

-- ── 3. Give the child indexes stable names ─────────────────────────────────
-- The live index may be idx_takeoff_catalog_item, catalog_item_id, or the
-- old FK name. Rename the first leftover, then ensure the target name exists.

SET @idx_services = (
    SELECT INDEX_NAME
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'section_services'
       AND COLUMN_NAME = 'service_kit_id'
       AND INDEX_NAME <> 'PRIMARY'
       AND INDEX_NAME <> 'idx_services_service_kit'
     LIMIT 1
);
SET @rename_idx_services = IF(
    @idx_services IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE section_services RENAME INDEX `', @idx_services, '` TO `idx_services_service_kit`')
);
PREPARE stmt_rename_idx_services FROM @rename_idx_services;
EXECUTE stmt_rename_idx_services;
DEALLOCATE PREPARE stmt_rename_idx_services;

SET @add_idx_services = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'section_services'
        AND INDEX_NAME = 'idx_services_service_kit') > 0,
    'SELECT 1',
    'ALTER TABLE section_services ADD INDEX idx_services_service_kit (service_kit_id)'
);
PREPARE stmt_add_idx_services FROM @add_idx_services;
EXECUTE stmt_add_idx_services;
DEALLOCATE PREPARE stmt_add_idx_services;

SET @idx_takeoff = (
    SELECT INDEX_NAME
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'takeoff_lines'
       AND COLUMN_NAME = 'service_kit_id'
       AND INDEX_NAME <> 'PRIMARY'
       AND INDEX_NAME <> 'idx_takeoff_service_kit'
     LIMIT 1
);
SET @rename_idx_takeoff = IF(
    @idx_takeoff IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE takeoff_lines RENAME INDEX `', @idx_takeoff, '` TO `idx_takeoff_service_kit`')
);
PREPARE stmt_rename_idx_takeoff FROM @rename_idx_takeoff;
EXECUTE stmt_rename_idx_takeoff;
DEALLOCATE PREPARE stmt_rename_idx_takeoff;

SET @add_idx_takeoff = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'takeoff_lines'
        AND INDEX_NAME = 'idx_takeoff_service_kit') > 0,
    'SELECT 1',
    'ALTER TABLE takeoff_lines ADD INDEX idx_takeoff_service_kit (service_kit_id)'
);
PREPARE stmt_add_idx_takeoff FROM @add_idx_takeoff;
EXECUTE stmt_add_idx_takeoff;
DEALLOCATE PREPARE stmt_add_idx_takeoff;

-- ── 4. Rename the kit table ────────────────────────────────────────────────
-- Only when catalog_items is still the kit table (it has kit_type).

SET @rename_kit_table = IF(
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits') > 0,
    'SELECT 1',
    IF(
        (SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'catalog_items'
            AND COLUMN_NAME = 'kit_type') = 0,
        'SELECT 1',
        'RENAME TABLE catalog_items TO service_kits'
    )
);
PREPARE stmt_rename_kit_table FROM @rename_kit_table;
EXECUTE stmt_rename_kit_table;
DEALLOCATE PREPARE stmt_rename_kit_table;

-- Kit-table index names traveled with the RENAME. Give them kit-specific names.

SET @rename_idx_kit_type = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'service_kits'
        AND INDEX_NAME = 'idx_catalog_kit_type') = 0,
    'SELECT 1',
    'ALTER TABLE service_kits RENAME INDEX idx_catalog_kit_type TO idx_service_kits_kit_type'
);
PREPARE stmt_rename_idx_kit_type FROM @rename_idx_kit_type;
EXECUTE stmt_rename_idx_kit_type;
DEALLOCATE PREPARE stmt_rename_idx_kit_type;

SET @rename_idx_kit_active = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'service_kits'
        AND INDEX_NAME = 'idx_catalog_active') = 0,
    'SELECT 1',
    'ALTER TABLE service_kits RENAME INDEX idx_catalog_active TO idx_service_kits_active'
);
PREPARE stmt_rename_idx_kit_active FROM @rename_idx_kit_active;
EXECUTE stmt_rename_idx_kit_active;
DEALLOCATE PREPARE stmt_rename_idx_kit_active;

SET @rename_idx_kit_branch = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'service_kits'
        AND INDEX_NAME = 'idx_catalog_aspire_branch') = 0,
    'SELECT 1',
    'ALTER TABLE service_kits RENAME INDEX idx_catalog_aspire_branch TO idx_service_kits_aspire_branch'
);
PREPARE stmt_rename_idx_kit_branch FROM @rename_idx_kit_branch;
EXECUTE stmt_rename_idx_kit_branch;
DEALLOCATE PREPARE stmt_rename_idx_kit_branch;

-- ── 5. Point the child FKs at service_kits ─────────────────────────────────
-- Added on both dev and prod. ON DELETE SET NULL matches the previous
-- section_services and prod takeoff behavior.

SET @add_fk_services = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'section_services'
        AND CONSTRAINT_NAME = 'fk_services_service_kit'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE section_services ADD CONSTRAINT fk_services_service_kit FOREIGN KEY (service_kit_id) REFERENCES service_kits (id) ON DELETE SET NULL'
);
PREPARE stmt_add_fk_services FROM @add_fk_services;
EXECUTE stmt_add_fk_services;
DEALLOCATE PREPARE stmt_add_fk_services;

SET @add_fk_takeoff = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'takeoff_lines'
        AND CONSTRAINT_NAME = 'fk_takeoff_service_kit'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE takeoff_lines ADD CONSTRAINT fk_takeoff_service_kit FOREIGN KEY (service_kit_id) REFERENCES service_kits (id) ON DELETE SET NULL'
);
PREPARE stmt_add_fk_takeoff FROM @add_fk_takeoff;
EXECUTE stmt_add_fk_takeoff;
DEALLOCATE PREPARE stmt_add_fk_takeoff;
