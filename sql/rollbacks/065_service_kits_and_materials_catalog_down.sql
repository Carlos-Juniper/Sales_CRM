-- ---------------------------------------------------------------------------
-- Rollback for 065_service_kits_and_materials_catalog.sql
--
-- scripts/migrate.py does not run files outside sql/migrations/. Apply this
-- by hand only to undo 065 before any materials or prices have been loaded:
--
--   mysql ... crm < sql/rollbacks/065_service_kits_and_materials_catalog_down.sql
--
-- This DROPs catalog_prices and the materials catalog_items table. Do not
-- run it after the spreadsheet import. Kit rows in service_kits are renamed
-- back to catalog_items; they are not deleted.
--
-- After rollback, both dev and prod have fk_services_catalog_item and
-- fk_takeoff_catalog_item. Prod had the takeoff FK before 065; dev did not.
-- Rollback does not recreate that drift.
--
-- Statements are guarded so a second run is a no-op.
-- ---------------------------------------------------------------------------

SET @drop_prices = IF(
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_prices') = 0,
    'SELECT 1',
    'DROP TABLE catalog_prices'
);
PREPARE stmt_drop_prices FROM @drop_prices;
EXECUTE stmt_drop_prices;
DEALLOCATE PREPARE stmt_drop_prices;

-- Drop only the materials master. kit_type means this is still the kit table
-- and must not be dropped.
SET @drop_materials = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'catalog_items'
        AND COLUMN_NAME = 'inventory_id') = 0,
    'SELECT 1',
    'DROP TABLE catalog_items'
);
PREPARE stmt_drop_materials FROM @drop_materials;
EXECUTE stmt_drop_materials;
DEALLOCATE PREPARE stmt_drop_materials;

SET @fk_services = (
    SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'section_services'
       AND COLUMN_NAME IN ('service_kit_id', 'catalog_item_id')
       AND REFERENCED_TABLE_NAME IS NOT NULL
     LIMIT 1
);
SET @drop_fk_services = IF(
    @fk_services IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE section_services DROP FOREIGN KEY `', @fk_services, '`')
);
PREPARE stmt_drop_fk_services FROM @drop_fk_services;
EXECUTE stmt_drop_fk_services;
DEALLOCATE PREPARE stmt_drop_fk_services;

SET @fk_takeoff = (
    SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'takeoff_lines'
       AND COLUMN_NAME IN ('service_kit_id', 'catalog_item_id')
       AND REFERENCED_TABLE_NAME IS NOT NULL
     LIMIT 1
);
SET @drop_fk_takeoff = IF(
    @fk_takeoff IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE takeoff_lines DROP FOREIGN KEY `', @fk_takeoff, '`')
);
PREPARE stmt_drop_fk_takeoff FROM @drop_fk_takeoff;
EXECUTE stmt_drop_fk_takeoff;
DEALLOCATE PREPARE stmt_drop_fk_takeoff;

SET @rename_services_back = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'section_services'
        AND COLUMN_NAME = 'service_kit_id') = 0,
    'SELECT 1',
    'ALTER TABLE section_services RENAME COLUMN service_kit_id TO catalog_item_id'
);
PREPARE stmt_rename_services_back FROM @rename_services_back;
EXECUTE stmt_rename_services_back;
DEALLOCATE PREPARE stmt_rename_services_back;

SET @rename_takeoff_back = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'takeoff_lines'
        AND COLUMN_NAME = 'service_kit_id') = 0,
    'SELECT 1',
    'ALTER TABLE takeoff_lines RENAME COLUMN service_kit_id TO catalog_item_id'
);
PREPARE stmt_rename_takeoff_back FROM @rename_takeoff_back;
EXECUTE stmt_rename_takeoff_back;
DEALLOCATE PREPARE stmt_rename_takeoff_back;

SET @idx_services = (
    SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'section_services'
       AND COLUMN_NAME = 'catalog_item_id'
       AND INDEX_NAME <> 'PRIMARY'
       AND INDEX_NAME <> 'catalog_item_id'
     LIMIT 1
);
SET @rename_idx_services = IF(
    @idx_services IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE section_services RENAME INDEX `', @idx_services, '` TO `catalog_item_id`')
);
PREPARE stmt_rename_idx_services FROM @rename_idx_services;
EXECUTE stmt_rename_idx_services;
DEALLOCATE PREPARE stmt_rename_idx_services;

SET @idx_takeoff = (
    SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'takeoff_lines'
       AND COLUMN_NAME = 'catalog_item_id'
       AND INDEX_NAME <> 'PRIMARY'
       AND INDEX_NAME <> 'idx_takeoff_catalog_item'
     LIMIT 1
);
SET @rename_idx_takeoff = IF(
    @idx_takeoff IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE takeoff_lines RENAME INDEX `', @idx_takeoff, '` TO `idx_takeoff_catalog_item`')
);
PREPARE stmt_rename_idx_takeoff FROM @rename_idx_takeoff;
EXECUTE stmt_rename_idx_takeoff;
DEALLOCATE PREPARE stmt_rename_idx_takeoff;

SET @rename_indexes_back_type = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'service_kits'
        AND INDEX_NAME = 'idx_service_kits_kit_type') = 0,
    'SELECT 1',
    'ALTER TABLE service_kits RENAME INDEX idx_service_kits_kit_type TO idx_catalog_kit_type'
);
PREPARE stmt_rename_indexes_back_type FROM @rename_indexes_back_type;
EXECUTE stmt_rename_indexes_back_type;
DEALLOCATE PREPARE stmt_rename_indexes_back_type;

SET @rename_indexes_back_active = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'service_kits'
        AND INDEX_NAME = 'idx_service_kits_active') = 0,
    'SELECT 1',
    'ALTER TABLE service_kits RENAME INDEX idx_service_kits_active TO idx_catalog_active'
);
PREPARE stmt_rename_indexes_back_active FROM @rename_indexes_back_active;
EXECUTE stmt_rename_indexes_back_active;
DEALLOCATE PREPARE stmt_rename_indexes_back_active;

SET @rename_indexes_back_branch = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'service_kits'
        AND INDEX_NAME = 'idx_service_kits_aspire_branch') = 0,
    'SELECT 1',
    'ALTER TABLE service_kits RENAME INDEX idx_service_kits_aspire_branch TO idx_catalog_aspire_branch'
);
PREPARE stmt_rename_indexes_back_branch FROM @rename_indexes_back_branch;
EXECUTE stmt_rename_indexes_back_branch;
DEALLOCATE PREPARE stmt_rename_indexes_back_branch;

SET @rename_table_back = IF(
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits') = 0,
    'SELECT 1',
    IF(
        (SELECT COUNT(*) FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_items') > 0,
        'SELECT 1',
        'RENAME TABLE service_kits TO catalog_items'
    )
);
PREPARE stmt_rename_table_back FROM @rename_table_back;
EXECUTE stmt_rename_table_back;
DEALLOCATE PREPARE stmt_rename_table_back;

SET @add_fk_services = IF(
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_items') = 0,
    'SELECT 1',
    IF(
        (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'section_services'
            AND CONSTRAINT_NAME = 'fk_services_catalog_item'
            AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
        'SELECT 1',
        'ALTER TABLE section_services ADD CONSTRAINT fk_services_catalog_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items (id) ON DELETE SET NULL'
    )
);
PREPARE stmt_add_fk_services FROM @add_fk_services;
EXECUTE stmt_add_fk_services;
DEALLOCATE PREPARE stmt_add_fk_services;

SET @add_fk_takeoff = IF(
    (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_items') = 0,
    'SELECT 1',
    IF(
        (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'takeoff_lines'
            AND CONSTRAINT_NAME = 'fk_takeoff_catalog_item'
            AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
        'SELECT 1',
        'ALTER TABLE takeoff_lines ADD CONSTRAINT fk_takeoff_catalog_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_items (id) ON DELETE SET NULL'
    )
);
PREPARE stmt_add_fk_takeoff FROM @add_fk_takeoff;
EXECUTE stmt_add_fk_takeoff;
DEALLOCATE PREPARE stmt_add_fk_takeoff;
