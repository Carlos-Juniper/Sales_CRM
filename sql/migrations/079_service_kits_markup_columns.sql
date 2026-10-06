-- ---------------------------------------------------------------------------
-- Migration 079 — service_kits markup + material columns (Handoff 59 Track A)
--
-- Adds the labor+material split pricing model to service_kits:
--
--   labor_markup_pct         Multiplier applied to labor cost to get labor sell.
--                            Company-wide; does not vary per branch.
--   material_markup_pct      Multiplier applied to material cost to get material sell.
--                            Company-wide; does not vary per branch.
--   material_unit_cost_cents Material input cost per kit unit (cents). NULL when
--                            the kit has no material component.
--   material_qty_per_unit    Material quantity consumed per kit unit (e.g. bags/sqft).
--                            NULL when no material component.
--   material_uom             Unit of measure for material_qty_per_unit (e.g. "Bag").
--                            NULL when no material component.
--   is_primary               1 when this kit is the primary kit for its service
--                            (the one seeded into section_services on estimate creation).
--
-- All six columns are guarded by information_schema.COLUMNS checks using the
-- PREPARE/EXECUTE pattern from migration 075.
--
-- detect_079 keys on is_primary existing on service_kits (the last column added).
-- A re-run after a partial apply finishes the remainder safely.
--
-- Rollback: sql/rollbacks/079_service_kits_markup_columns_down.sql
-- ---------------------------------------------------------------------------

-- ── 1. labor_markup_pct ─────────────────────────────────────────────────────
SET @sk_add_labor_markup_pct = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits'
        AND COLUMN_NAME = 'labor_markup_pct') > 0,
    'SELECT 1',
    'ALTER TABLE service_kits ADD COLUMN labor_markup_pct DECIMAL(6,2) DEFAULT NULL AFTER target_gm'
);
PREPARE stmt_sk_add_labor_markup_pct FROM @sk_add_labor_markup_pct;
EXECUTE stmt_sk_add_labor_markup_pct;
DEALLOCATE PREPARE stmt_sk_add_labor_markup_pct;

-- ── 2. material_markup_pct ──────────────────────────────────────────────────
SET @sk_add_material_markup_pct = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits'
        AND COLUMN_NAME = 'material_markup_pct') > 0,
    'SELECT 1',
    'ALTER TABLE service_kits ADD COLUMN material_markup_pct DECIMAL(6,2) DEFAULT NULL AFTER labor_markup_pct'
);
PREPARE stmt_sk_add_material_markup_pct FROM @sk_add_material_markup_pct;
EXECUTE stmt_sk_add_material_markup_pct;
DEALLOCATE PREPARE stmt_sk_add_material_markup_pct;

-- ── 3. material_unit_cost_cents ─────────────────────────────────────────────
SET @sk_add_material_unit_cost = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits'
        AND COLUMN_NAME = 'material_unit_cost_cents') > 0,
    'SELECT 1',
    'ALTER TABLE service_kits ADD COLUMN material_unit_cost_cents BIGINT DEFAULT NULL AFTER material_markup_pct'
);
PREPARE stmt_sk_add_material_unit_cost FROM @sk_add_material_unit_cost;
EXECUTE stmt_sk_add_material_unit_cost;
DEALLOCATE PREPARE stmt_sk_add_material_unit_cost;

-- ── 4. material_qty_per_unit ────────────────────────────────────────────────
SET @sk_add_material_qty = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits'
        AND COLUMN_NAME = 'material_qty_per_unit') > 0,
    'SELECT 1',
    'ALTER TABLE service_kits ADD COLUMN material_qty_per_unit DECIMAL(14,6) DEFAULT NULL AFTER material_unit_cost_cents'
);
PREPARE stmt_sk_add_material_qty FROM @sk_add_material_qty;
EXECUTE stmt_sk_add_material_qty;
DEALLOCATE PREPARE stmt_sk_add_material_qty;

-- ── 5. material_uom ─────────────────────────────────────────────────────────
SET @sk_add_material_uom = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits'
        AND COLUMN_NAME = 'material_uom') > 0,
    'SELECT 1',
    'ALTER TABLE service_kits ADD COLUMN material_uom VARCHAR(20) DEFAULT NULL AFTER material_qty_per_unit'
);
PREPARE stmt_sk_add_material_uom FROM @sk_add_material_uom;
EXECUTE stmt_sk_add_material_uom;
DEALLOCATE PREPARE stmt_sk_add_material_uom;

-- ── 6. is_primary — LAST, detect_079 keys here ──────────────────────────────
SET @sk_add_is_primary = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits'
        AND COLUMN_NAME = 'is_primary') > 0,
    'SELECT 1',
    'ALTER TABLE service_kits ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 0 AFTER material_uom'
);
PREPARE stmt_sk_add_is_primary FROM @sk_add_is_primary;
EXECUTE stmt_sk_add_is_primary;
DEALLOCATE PREPARE stmt_sk_add_is_primary;
