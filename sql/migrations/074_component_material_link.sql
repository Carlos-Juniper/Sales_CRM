-- ---------------------------------------------------------------------------
-- Migration 074 — link estimate components to materials; five cost buckets.
--
-- Handoff 55 §5 (level 3 of the install estimate). section_service_components
-- gets:
--
--   kind          ENUM('labor','material') widens to Aspire's five cost
--                 buckets ('labor','material','equipment','subcontractor',
--                 'other'), the same set service_default_items uses (073).
--                 Markups differ per bucket. Existing rows keep their kind:
--                 both old values stay in the list, in the same order.
--   inventory_id  VARCHAR(64) NULL, FK -> materials (inventory_id)
--                 ON DELETE RESTRICT ON UPDATE RESTRICT (inventory ids are
--                 Aspire item codes, never renamed in place; 070). NULL for
--                 labor / subcontractor / other rows and for every existing
--                 free-text component.
--
-- The component's unit_cost_cents stays a snapshot: the API copies the
-- current material_prices cost at insert, and nothing re-prices a saved
-- component. No materials, material_prices or item_classes row is written.
--
-- No triggers, functions, procedures or generated columns (Cloud SQL, binlog
-- on, no SUPER: ERROR 1419). Every statement is information_schema-guarded,
-- so a re-run after a partial apply finishes the rest. The FK is LAST:
-- detect_074 keys on it plus the column and the widened ENUM.
--
-- Rollback (not applied by the runner): sql/rollbacks/074_component_material_link_down.sql
-- ---------------------------------------------------------------------------

-- ── 1. widen kind ───────────────────────────────────────────────────────────
SET @ssc_kind = IF(
    (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND COLUMN_NAME = 'kind') = 'enum(''labor'',''material'',''equipment'',''subcontractor'',''other'')',
    'SELECT 1',
    'ALTER TABLE section_service_components MODIFY COLUMN kind ENUM(''labor'',''material'',''equipment'',''subcontractor'',''other'') NOT NULL'
);
PREPARE stmt_ssc_kind FROM @ssc_kind;
EXECUTE stmt_ssc_kind;
DEALLOCATE PREPARE stmt_ssc_kind;

-- ── 2. inventory_id column ──────────────────────────────────────────────────
-- Explicit charset/collation: materials.inventory_id is utf8mb4_unicode_ci
-- (070), and an FK needs both sides to match.
SET @ssc_add_inventory_id = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND COLUMN_NAME = 'inventory_id') > 0,
    'SELECT 1',
    'ALTER TABLE section_service_components ADD COLUMN inventory_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER label'
);
PREPARE stmt_ssc_add_inventory_id FROM @ssc_add_inventory_id;
EXECUTE stmt_ssc_add_inventory_id;
DEALLOCATE PREPARE stmt_ssc_add_inventory_id;

SET @ssc_idx_inventory_id = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND INDEX_NAME = 'idx_components_inventory') > 0,
    'SELECT 1',
    'ALTER TABLE section_service_components ADD INDEX idx_components_inventory (inventory_id)'
);
PREPARE stmt_ssc_idx_inventory_id FROM @ssc_idx_inventory_id;
EXECUTE stmt_ssc_idx_inventory_id;
DEALLOCATE PREPARE stmt_ssc_idx_inventory_id;

-- ── 3. FK to materials — LAST, detect_074 keys here ─────────────────────────
SET @ssc_fk_inventory_id = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND CONSTRAINT_NAME = 'fk_components_material' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE section_service_components ADD CONSTRAINT fk_components_material FOREIGN KEY (inventory_id) REFERENCES materials (inventory_id) ON DELETE RESTRICT ON UPDATE RESTRICT'
);
PREPARE stmt_ssc_fk_inventory_id FROM @ssc_fk_inventory_id;
EXECUTE stmt_ssc_fk_inventory_id;
DEALLOCATE PREPARE stmt_ssc_fk_inventory_id;
