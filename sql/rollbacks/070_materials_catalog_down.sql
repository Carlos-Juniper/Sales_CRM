-- ---------------------------------------------------------------------------
-- Rollback for 070_materials_catalog.sql
--
-- scripts/migrate.py does not run files outside sql/migrations/. Apply this
-- by hand only to undo 070 before any materials or prices have been loaded,
-- or when dropping the loaded catalog is acceptable:
--
--   mysql ... crm < sql/rollbacks/070_materials_catalog_down.sql
--
-- This DROPs material_price_loads, material_prices, and materials.
-- It does not touch service_kits.
--
-- The schema_migrations row for this file is deleted so the runner will
-- apply 070 again. Statements are idempotent.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_material_price_load_bi;
DROP TABLE IF EXISTS material_price_loads;
DROP TABLE IF EXISTS material_prices;
DROP TABLE IF EXISTS materials;

SET @clear_070 = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'schema_migrations'
        AND COLUMN_NAME = 'id') = 0,
    'SELECT 1',
    'DELETE FROM schema_migrations WHERE id = ''070_materials_catalog'''
);
PREPARE stmt_clear_070 FROM @clear_070;
EXECUTE stmt_clear_070;
DEALLOCATE PREPARE stmt_clear_070;
