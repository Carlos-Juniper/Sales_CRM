-- Rollback for 074_component_material_link. Not applied by scripts/migrate.py.
--
-- Drops the materials FK, index, inventory_id and uom columns (the component
-- rows stay; only their material link and unit label go), then narrows kind back to
-- ENUM('labor','material') ONLY when no component uses equipment,
-- subcontractor or other. If any does, kind is left wide and no row is
-- rewritten: decide what those rows become, update them, and re-run.
--   SELECT kind, COUNT(*) FROM section_service_components GROUP BY kind;
-- Every statement is guarded; the file is re-runnable.

SET @ssc_fk = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND CONSTRAINT_NAME = 'fk_components_material' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'ALTER TABLE section_service_components DROP FOREIGN KEY fk_components_material',
    'SELECT 1'
);
PREPARE stmt_ssc_fk FROM @ssc_fk;
EXECUTE stmt_ssc_fk;
DEALLOCATE PREPARE stmt_ssc_fk;

SET @ssc_idx = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND INDEX_NAME = 'idx_components_inventory') > 0,
    'ALTER TABLE section_service_components DROP INDEX idx_components_inventory',
    'SELECT 1'
);
PREPARE stmt_ssc_idx FROM @ssc_idx;
EXECUTE stmt_ssc_idx;
DEALLOCATE PREPARE stmt_ssc_idx;

SET @ssc_col = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND COLUMN_NAME = 'inventory_id') > 0,
    'ALTER TABLE section_service_components DROP COLUMN inventory_id',
    'SELECT 1'
);
PREPARE stmt_ssc_col FROM @ssc_col;
EXECUTE stmt_ssc_col;
DEALLOCATE PREPARE stmt_ssc_col;

SET @ssc_uom = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND COLUMN_NAME = 'uom') > 0,
    'ALTER TABLE section_service_components DROP COLUMN uom',
    'SELECT 1'
);
PREPARE stmt_ssc_uom FROM @ssc_uom;
EXECUTE stmt_ssc_uom;
DEALLOCATE PREPARE stmt_ssc_uom;

SET @ssc_kind = IF(
    (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_service_components'
        AND COLUMN_NAME = 'kind') = 'enum(''labor'',''material'')'
    OR (SELECT COUNT(*) FROM section_service_components
         WHERE kind NOT IN ('labor', 'material')) > 0,
    'SELECT ''kind left as is (already narrow, or rows use the wider kinds)'' AS note',
    'ALTER TABLE section_service_components MODIFY COLUMN kind ENUM(''labor'',''material'') NOT NULL'
);
PREPARE stmt_ssc_kind FROM @ssc_kind;
EXECUTE stmt_ssc_kind;
DEALLOCATE PREPARE stmt_ssc_kind;

SET @clear_074 = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'schema_migrations'
        AND COLUMN_NAME = 'id') = 0,
    'SELECT 1',
    'DELETE FROM schema_migrations WHERE id = ''074_component_material_link'''
);
PREPARE stmt_clear_074 FROM @clear_074;
EXECUTE stmt_clear_074;
DEALLOCATE PREPARE stmt_clear_074;
