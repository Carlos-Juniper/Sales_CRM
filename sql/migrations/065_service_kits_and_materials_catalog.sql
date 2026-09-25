-- ---------------------------------------------------------------------------
-- Migration 065 — rename kit catalog to service_kits; add materials catalog.
--
-- Numbered 065 because 064 is the last file on main, 056 is unused, and
-- 059–061 belong to branch-manager work on integrate/staging-proposals.
-- A duplicate number is silently skipped by scripts/migrate.py.
--
-- Two effects, both required before this file is "applied":
--   1. The priced service-kit table catalog_items becomes service_kits.
--      section_services.catalog_item_id and takeoff_lines.catalog_item_id
--      become service_kit_id and reference service_kits. The old column
--      name would point at the new materials table, which it does not.
--   2. A new catalog_items table holds material item-master data only
--      (no sell price, no cost). catalog_prices holds cost history.
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
-- database that already ran 065 is not mistaken for one that never seeded
-- kits. The historical SQL files themselves are unchanged: on a fresh
-- database they run while the table is still called catalog_items.
--
-- Rollback (not applied by the runner): sql/rollbacks/065_service_kits_and_materials_catalog_down.sql
-- The runner has no down path. That file is outside sql/migrations/ so
-- migrate.py will not execute it.
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
-- Do this before the table rename so a re-run can see service_kit_id even
-- when catalog_items has already become the materials table.

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
-- Only when catalog_items is still the kit table (it has kit_type). After
-- this file succeeds, catalog_items is the materials master and must not
-- be renamed again.

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

-- ── 6. Materials item master (the new catalog_items) ───────────────────────
-- Item master only. Cost lives in catalog_prices. There is no sell price
-- and no margin. inventory_id is the Aspire item code and the upsert key.
-- aspire_catalog_item_id is reserved for Aspire's numeric CatalogItemID,
-- which the spreadsheet does not contain.
--
-- No kit-component table: materials do not roll up into service kits.

CREATE TABLE IF NOT EXISTS catalog_items (
    inventory_id            VARCHAR(10)  NOT NULL,
    aspire_catalog_item_id  BIGINT       DEFAULT NULL,
    description             VARCHAR(255) NOT NULL,
    alternate_name          VARCHAR(255) DEFAULT NULL,
    item_class              VARCHAR(128) DEFAULT NULL,
    aspire_category         VARCHAR(128) DEFAULT NULL,
    posting_class           VARCHAR(64)  DEFAULT NULL,
    manufacturer            VARCHAR(128) DEFAULT NULL,
    base_uom                VARCHAR(32)  DEFAULT NULL,
    sales_uom               VARCHAR(32)  DEFAULT NULL,
    purchase_uom            VARCHAR(32)  DEFAULT NULL,
    purchase_to_base_factor DECIMAL(14,6) DEFAULT NULL,
    preferred_vendor_id     VARCHAR(64)  DEFAULT NULL,
    preferred_vendor_name   VARCHAR(128) DEFAULT NULL,
    vendor_sku              VARCHAR(128) DEFAULT NULL,
    is_stock_item           TINYINT(1)   NOT NULL,
    available_to_bid        TINYINT(1)   NOT NULL DEFAULT 1,
    active                  TINYINT(1)   NOT NULL DEFAULT 1,
    created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (inventory_id),
    UNIQUE KEY uq_catalog_items_aspire_id (aspire_catalog_item_id),
    KEY idx_catalog_items_class (item_class),
    KEY idx_catalog_items_aspire_category (aspire_category),
    KEY idx_catalog_items_bid_active (available_to_bid, active),
    KEY idx_catalog_items_vendor (preferred_vendor_id, vendor_sku),
    KEY idx_catalog_items_manufacturer (manufacturer),
    CONSTRAINT chk_catalog_items_inventory_id
        CHECK (inventory_id REGEXP '^[0-9]{10}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. Cost history ────────────────────────────────────────────────────────
-- One current row per item. Writers set is_current = 1 for the live cost
-- and 0 for history. The triggers below copy inventory_id into
-- current_inventory_id only on the current row (NULL on history). The
-- unique key then allows many historical rows and one current row.
--
-- MariaDB 10.11 rejects both a generated column and a CHECK that read a
-- foreign-key column (ERROR 1901). Local bootstrap is MariaDB; Cloud SQL
-- is MySQL 8.4. The trigger works on both, and the CHECK only mentions
-- is_current and current_inventory_id.
-- Estimators read unit_cost_cents only. There is no sell price.
-- estimate_id is unused until a procurement queue exists. ON DELETE SET NULL
-- so retiring an estimate does not delete the cost that was entered for it.

CREATE TABLE IF NOT EXISTS catalog_prices (
    id                   VARCHAR(36)  NOT NULL,
    inventory_id         VARCHAR(10)  NOT NULL,
    unit_cost_cents      BIGINT       NOT NULL,
    uom                  VARCHAR(32)  NOT NULL,
    vendor_id            VARCHAR(64)  DEFAULT NULL,
    vendor_name          VARCHAR(128) DEFAULT NULL,
    effective_from       DATE         NOT NULL,
    effective_to         DATE         DEFAULT NULL,
    is_current           TINYINT(1)   NOT NULL DEFAULT 0,
    current_inventory_id VARCHAR(10)  DEFAULT NULL,
    source               VARCHAR(32)  NOT NULL,
    estimate_id          VARCHAR(36)  DEFAULT NULL,
    entered_by           VARCHAR(255) DEFAULT NULL,
    notes                TEXT         DEFAULT NULL,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_catalog_prices_one_current (current_inventory_id),
    KEY idx_catalog_prices_item (inventory_id, effective_from),
    KEY idx_catalog_prices_current (inventory_id, is_current),
    KEY idx_catalog_prices_estimate (estimate_id),
    CONSTRAINT chk_catalog_prices_cost_nonnegative CHECK (unit_cost_cents >= 0),
    CONSTRAINT chk_catalog_prices_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT chk_catalog_prices_current_marker CHECK (
        (is_current = 0 AND current_inventory_id IS NULL)
        OR (is_current = 1 AND current_inventory_id IS NOT NULL)
    ),
    CONSTRAINT fk_catalog_prices_item
        FOREIGN KEY (inventory_id) REFERENCES catalog_items (inventory_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_catalog_prices_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Force the current-row marker onto this item's inventory_id. Re-runnable:
-- DROP IF EXISTS then CREATE. DROP TABLE catalog_prices removes these.

DROP TRIGGER IF EXISTS trg_catalog_prices_bi;
CREATE TRIGGER trg_catalog_prices_bi
BEFORE INSERT ON catalog_prices
FOR EACH ROW
SET NEW.current_inventory_id = IF(NEW.is_current = 1, NEW.inventory_id, NULL);

DROP TRIGGER IF EXISTS trg_catalog_prices_bu;
CREATE TRIGGER trg_catalog_prices_bu
BEFORE UPDATE ON catalog_prices
FOR EACH ROW
SET NEW.current_inventory_id = IF(NEW.is_current = 1, NEW.inventory_id, NULL);
