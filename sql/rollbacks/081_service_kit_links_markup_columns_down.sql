-- Rollback 081: remove markup columns from service_kit_links

SET @db = 'crm'; SET @tbl = 'service_kit_links';

SET @col = 'material_markup_pct';
SET @stmt = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name=@tbl AND column_name=@col),
    CONCAT('ALTER TABLE ',@db,'.',@tbl,' DROP COLUMN material_markup_pct'), 'SELECT 1');
PREPARE _s FROM @stmt; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @col = 'labor_markup_pct';
SET @stmt = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name=@tbl AND column_name=@col),
    CONCAT('ALTER TABLE ',@db,'.',@tbl,' DROP COLUMN labor_markup_pct'), 'SELECT 1');
PREPARE _s FROM @stmt; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @col = 'is_primary';
SET @stmt = IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@db AND table_name=@tbl AND column_name=@col),
    CONCAT('ALTER TABLE ',@db,'.',@tbl,' DROP COLUMN is_primary'), 'SELECT 1');
PREPARE _s FROM @stmt; EXECUTE _s; DEALLOCATE PREPARE _s;

DELETE FROM crm.schema_migrations WHERE migration = '081_service_kit_links_markup_columns';
