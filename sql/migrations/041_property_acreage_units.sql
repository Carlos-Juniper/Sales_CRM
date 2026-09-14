-- ---------------------------------------------------------------------------
-- Migration 041 — properties.acreage + properties.units.
--
-- The Maintenance/Install intake forms each grew their own duplicate
-- property/location fields alongside the shared PropertySelector's
-- "create new property" section. Consolidating them means the create-property
-- section needs to capture acreage + unit count itself, so both become real
-- columns on the canonical `properties` table (previously acreage only lived
-- per-estimate on `estimates.acreage`; units had no home anywhere).
--
-- Both ADDs are guarded on information_schema per the README's detector rule
-- (a detector must test its own migration's effect, and every ADD in a
-- multi-statement migration must be individually guarded) — mirrors
-- 031/027/028/032.
-- ---------------------------------------------------------------------------

SET @add_prop_acreage = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'properties'
       AND column_name  = 'acreage') > 0,
    'SELECT 1',
    'ALTER TABLE `properties` ADD COLUMN `acreage` DECIMAL(10,2) DEFAULT NULL'
);
PREPARE stmt_add_prop_acreage FROM @add_prop_acreage;
EXECUTE stmt_add_prop_acreage;
DEALLOCATE PREPARE stmt_add_prop_acreage;

SET @add_prop_units = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'properties'
       AND column_name  = 'units') > 0,
    'SELECT 1',
    'ALTER TABLE `properties` ADD COLUMN `units` INT DEFAULT NULL'
);
PREPARE stmt_add_prop_units FROM @add_prop_units;
EXECUTE stmt_add_prop_units;
DEALLOCATE PREPARE stmt_add_prop_units;
