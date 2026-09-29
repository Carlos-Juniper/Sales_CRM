-- ---------------------------------------------------------------------------
-- Migration 070 — materials item master and cost history.
--
-- Numbered 070. 069 renames the kit table to service_kits. 065 is the
-- open commission-cadence migration, and 067/068 are the open sales-role
-- migrations. Nothing in this file upgrades an earlier draft: that schema
-- was never deployed.
--
-- materials holds item-master data only (no sell price, no cost).
-- material_prices holds cost history. One current row per item:
-- is_current = 1 and current_inventory_id = inventory_id on the live row,
-- NULL on history. The unique key allows many history rows (multiple NULLs)
-- and one current row.
--
-- MariaDB 10.11 rejects a generated column or a CHECK that reads a
-- foreign-key column (ERROR 1901). The marker triggers set
-- current_inventory_id. A trigger on material_prices cannot update other
-- rows of material_prices (ERROR 1442 on MariaDB 10.11 and MySQL 8.4), so
-- price history is recorded by trg_material_price_load_bi on
-- material_price_loads. The loader inserts the desired current cost there.
-- The trigger closes the previous current row and inserts the new one.
-- An unchanged cost inserts nothing.
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
    current_inventory_id VARCHAR(64)  DEFAULT NULL,
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
    CONSTRAINT chk_material_prices_current_marker CHECK (
        (is_current = 0 AND current_inventory_id IS NULL)
        OR (is_current = 1 AND current_inventory_id IS NOT NULL)
    ),
    CONSTRAINT fk_material_prices_item
        FOREIGN KEY (inventory_id) REFERENCES materials (inventory_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_material_prices_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TRIGGER IF EXISTS trg_material_prices_bi;
CREATE TRIGGER trg_material_prices_bi
BEFORE INSERT ON material_prices
FOR EACH ROW
SET NEW.current_inventory_id = IF(NEW.is_current = 1, NEW.inventory_id, NULL);

DROP TRIGGER IF EXISTS trg_material_prices_bu;
CREATE TRIGGER trg_material_prices_bu
BEFORE UPDATE ON material_prices
FOR EACH ROW
SET NEW.current_inventory_id = IF(NEW.is_current = 1, NEW.inventory_id, NULL);

-- Write buffer. The loader inserts the cost it wants to be current.
-- trg_material_price_load_bi records history on material_prices.
-- Rows here are not the price record; the loader deletes them after the trigger runs.
CREATE TABLE IF NOT EXISTS material_price_loads (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    inventory_id    VARCHAR(64)  NOT NULL,
    unit_cost_cents BIGINT       NOT NULL,
    uom             VARCHAR(32)  NOT NULL,
    vendor_id       VARCHAR(64)  DEFAULT NULL,
    vendor_name     VARCHAR(128) DEFAULT NULL,
    effective_from  DATE         NOT NULL,
    source          VARCHAR(32)  NOT NULL,
    entered_by      VARCHAR(255) DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_material_price_loads_item (inventory_id),
    CONSTRAINT fk_material_price_loads_item
        FOREIGN KEY (inventory_id) REFERENCES materials (inventory_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_material_price_loads_cost_nonnegative CHECK (unit_cost_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TRIGGER IF EXISTS trg_material_price_load_bi;
CREATE TRIGGER trg_material_price_load_bi
BEFORE INSERT ON material_price_loads
FOR EACH ROW
BEGIN
    DECLARE cur_id VARCHAR(36);
    DECLARE cur_cost BIGINT;
    DECLARE cur_from DATE;
    DECLARE cur_to DATE;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET cur_id = NULL;

    SELECT id, unit_cost_cents, effective_from
      INTO cur_id, cur_cost, cur_from
      FROM material_prices
     WHERE inventory_id = NEW.inventory_id AND is_current = 1
     LIMIT 1;

    IF cur_id IS NULL THEN
        INSERT INTO material_prices (
            id, inventory_id, unit_cost_cents, uom, vendor_id, vendor_name,
            effective_from, is_current, source, entered_by
        ) VALUES (
            UUID(), NEW.inventory_id, NEW.unit_cost_cents, NEW.uom,
            NEW.vendor_id, NEW.vendor_name, NEW.effective_from, 1,
            NEW.source, NEW.entered_by
        );
    ELSEIF cur_cost <> NEW.unit_cost_cents THEN
        SET cur_to = IF(cur_from > NEW.effective_from, cur_from, NEW.effective_from);
        UPDATE material_prices
           SET is_current = 0, effective_to = cur_to
         WHERE id = cur_id AND is_current = 1;
        INSERT INTO material_prices (
            id, inventory_id, unit_cost_cents, uom, vendor_id, vendor_name,
            effective_from, is_current, source, entered_by
        ) VALUES (
            UUID(), NEW.inventory_id, NEW.unit_cost_cents, NEW.uom,
            NEW.vendor_id, NEW.vendor_name, NEW.effective_from, 1,
            NEW.source, NEW.entered_by
        );
    END IF;
END;
