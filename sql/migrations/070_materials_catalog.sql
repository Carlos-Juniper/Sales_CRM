-- ---------------------------------------------------------------------------
-- Migration 070 — materials item master and cost history.
--
-- Numbered 070. 069 renames the kit table to service_kits. 065 is the
-- open commission-cadence migration, and 067/068 are the open sales-role
-- migrations.
--
-- materials holds item-master data only (no sell price, no cost).
-- material_prices holds cost history. One current row per item:
-- is_current = 1 on the live row. current_inventory_id is a STORED
-- generated column (inventory_id on the current row, NULL on history).
-- The unique key allows many history rows (multiple NULLs) and one
-- current row.
--
-- No triggers, stored functions, or procedures. Cloud SQL runs with binary
-- logging on and the migration user has no SUPER, so CREATE TRIGGER fails
-- with ERROR 1419 (the first version of this file did exactly that on
-- juniper-dev). Price history is written by the loader
-- (scripts/load_materials_catalog.py): per item it locks the current row
-- with SELECT ... FOR UPDATE, closes it when the cost changed, and inserts
-- the new current row. An unchanged cost writes nothing.
--
-- MySQL 8 forbids ON UPDATE CASCADE / SET NULL on a base column of a stored
-- generated column, so fk_material_prices_item is ON UPDATE RESTRICT.
-- inventory_id values are Aspire item codes and are not renamed in place.
--
-- Re-runnable. The first version of this file stopped at its first CREATE
-- TRIGGER after creating materials and an older material_prices shape
-- (plain current_inventory_id, a marker CHECK, fk_material_prices_item
-- ON UPDATE CASCADE) and was not recorded in schema_migrations. Every
-- change to that shape below is guarded on information_schema, so this
-- file finishes that state and also runs on an empty database.
--
-- inventory_id is the Aspire item code exactly as it appears on the sheet
-- (trimmed, never zero-padded). Any non-empty string up to 64 characters
-- is allowed. aspire_catalog_item_id is reserved for Aspire's numeric
-- CatalogItemID, which the spreadsheet does not contain.
--
-- Rollback (not applied by the runner):
-- sql/rollbacks/070_materials_catalog_down.sql
-- That file also deletes this file's schema_migrations row.
-- ---------------------------------------------------------------------------

-- ── 1. Remove objects from the first version ────────────────────────────────
-- None exist on juniper-dev. A database where they were created (a server
-- that allowed the triggers) drops them here. DROP TRIGGER needs no SUPER.
DROP TRIGGER IF EXISTS trg_material_price_load_bi;
DROP TRIGGER IF EXISTS trg_material_prices_bi;
DROP TRIGGER IF EXISTS trg_material_prices_bu;
DROP TABLE IF EXISTS material_price_loads;

-- ── 2. Item master ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS materials (
    inventory_id            VARCHAR(64)  NOT NULL,
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
    UNIQUE KEY uq_materials_aspire_id (aspire_catalog_item_id),
    KEY idx_materials_class (item_class),
    KEY idx_materials_aspire_category (aspire_category),
    KEY idx_materials_bid_active (available_to_bid, active),
    KEY idx_materials_vendor (preferred_vendor_id, vendor_sku),
    KEY idx_materials_manufacturer (manufacturer),
    CONSTRAINT chk_materials_inventory_id
        CHECK (inventory_id <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Cost history (final shape on an empty database) ─────────────────────
CREATE TABLE IF NOT EXISTS material_prices (
    id                   VARCHAR(36)  NOT NULL,
    inventory_id         VARCHAR(64)  NOT NULL,
    unit_cost_cents      BIGINT       NOT NULL,
    uom                  VARCHAR(32)  NOT NULL,
    vendor_id            VARCHAR(64)  DEFAULT NULL,
    vendor_name          VARCHAR(128) DEFAULT NULL,
    effective_from       DATE         NOT NULL,
    effective_to         DATE         DEFAULT NULL,
    is_current           TINYINT(1)   NOT NULL DEFAULT 0,
    current_inventory_id VARCHAR(64)
        GENERATED ALWAYS AS (CASE WHEN is_current = 1 THEN inventory_id END) STORED,
    source               VARCHAR(32)  NOT NULL,
    estimate_id          VARCHAR(36)  DEFAULT NULL,
    entered_by           VARCHAR(255) DEFAULT NULL,
    notes                TEXT         DEFAULT NULL,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_material_prices_one_current (current_inventory_id),
    KEY idx_material_prices_item (inventory_id, effective_from),
    KEY idx_material_prices_current (inventory_id, is_current),
    KEY idx_material_prices_estimate (estimate_id),
    CONSTRAINT chk_material_prices_cost_nonnegative CHECK (unit_cost_cents >= 0),
    CONSTRAINT chk_material_prices_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT fk_material_prices_item
        FOREIGN KEY (inventory_id) REFERENCES materials (inventory_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_material_prices_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Upgrade the first version's material_prices shape ───────────────────
-- 4a. The CASCADE item FK blocks a generated column on inventory_id.
SET @mp_drop_item_fk = IF(
    (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'material_prices'
        AND CONSTRAINT_NAME = 'fk_material_prices_item'
        AND (UPDATE_RULE <> 'RESTRICT' OR DELETE_RULE <> 'RESTRICT')) = 0,
    'SELECT 1',
    'ALTER TABLE material_prices DROP FOREIGN KEY fk_material_prices_item'
);
PREPARE stmt_mp_drop_item_fk FROM @mp_drop_item_fk;
EXECUTE stmt_mp_drop_item_fk;
DEALLOCATE PREPARE stmt_mp_drop_item_fk;

-- 4b. The marker CHECK is redundant once the column is generated.
SET @mp_drop_marker = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'material_prices'
        AND CONSTRAINT_NAME = 'chk_material_prices_current_marker'
        AND CONSTRAINT_TYPE = 'CHECK') = 0,
    'SELECT 1',
    'ALTER TABLE material_prices DROP CHECK chk_material_prices_current_marker'
);
PREPARE stmt_mp_drop_marker FROM @mp_drop_marker;
EXECUTE stmt_mp_drop_marker;
DEALLOCATE PREPARE stmt_mp_drop_marker;

-- 4c. A plain current_inventory_id: drop its unique key, then the column.
SET @mp_plain_marker = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'material_prices'
       AND COLUMN_NAME = 'current_inventory_id'
       AND UPPER(EXTRA) NOT LIKE '%GENERATED%'
);
SET @mp_drop_uq = IF(
    @mp_plain_marker = 0
    OR (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'material_prices'
           AND INDEX_NAME = 'uq_material_prices_one_current') = 0,
    'SELECT 1',
    'ALTER TABLE material_prices DROP INDEX uq_material_prices_one_current'
);
PREPARE stmt_mp_drop_uq FROM @mp_drop_uq;
EXECUTE stmt_mp_drop_uq;
DEALLOCATE PREPARE stmt_mp_drop_uq;

SET @mp_drop_marker_col = IF(
    @mp_plain_marker = 0,
    'SELECT 1',
    'ALTER TABLE material_prices DROP COLUMN current_inventory_id'
);
PREPARE stmt_mp_drop_marker_col FROM @mp_drop_marker_col;
EXECUTE stmt_mp_drop_marker_col;
DEALLOCATE PREPARE stmt_mp_drop_marker_col;

-- 4d. Add the generated marker column.
SET @mp_add_marker_col = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'material_prices'
        AND COLUMN_NAME = 'current_inventory_id') > 0,
    'SELECT 1',
    'ALTER TABLE material_prices ADD COLUMN current_inventory_id VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN is_current = 1 THEN inventory_id END) STORED AFTER is_current'
);
PREPARE stmt_mp_add_marker_col FROM @mp_add_marker_col;
EXECUTE stmt_mp_add_marker_col;
DEALLOCATE PREPARE stmt_mp_add_marker_col;

-- 4e. One current row per item.
SET @mp_add_uq = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'material_prices'
        AND INDEX_NAME = 'uq_material_prices_one_current') > 0,
    'SELECT 1',
    'ALTER TABLE material_prices ADD UNIQUE KEY uq_material_prices_one_current (current_inventory_id)'
);
PREPARE stmt_mp_add_uq FROM @mp_add_uq;
EXECUTE stmt_mp_add_uq;
DEALLOCATE PREPARE stmt_mp_add_uq;

-- 4f. Item FK, RESTRICT on update and delete.
SET @mp_add_item_fk = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'material_prices'
        AND CONSTRAINT_NAME = 'fk_material_prices_item'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE material_prices ADD CONSTRAINT fk_material_prices_item FOREIGN KEY (inventory_id) REFERENCES materials (inventory_id) ON DELETE RESTRICT ON UPDATE RESTRICT'
);
PREPARE stmt_mp_add_item_fk FROM @mp_add_item_fk;
EXECUTE stmt_mp_add_item_fk;
DEALLOCATE PREPARE stmt_mp_add_item_fk;
