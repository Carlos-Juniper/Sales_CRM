-- ---------------------------------------------------------------------------
-- Rollback for 073_service_catalog.sql
--
-- scripts/migrate.py does not run files outside sql/migrations/. Apply by
-- hand:
--
--   mysql ... crm < sql/rollbacks/073_service_catalog_down.sql
--
-- Drops the four catalog tables (and the seeded install catalog), the
-- section_services.service_id and estimate_sections.service_category_id
-- columns with their FKs and indexes, and the materials FULLTEXT index.
-- Estimate lines keep their label, prices and service_kit_id; only the
-- catalog link is lost. No materials, material_prices, item_classes,
-- item_class_groups or service_kits row is touched.
--
-- Roll back 074 first if it is applied (074 references materials, not these
-- tables, but the numbering should unwind in order).
--
-- Deletes this file's schema_migrations row so the runner applies 073
-- again. Statements are idempotent.
-- ---------------------------------------------------------------------------

SET @rb_ss_fk = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_services'
        AND CONSTRAINT_NAME = 'fk_section_services_service' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
    'SELECT 1',
    'ALTER TABLE section_services DROP FOREIGN KEY fk_section_services_service'
);
PREPARE stmt_rb_ss_fk FROM @rb_ss_fk;
EXECUTE stmt_rb_ss_fk;
DEALLOCATE PREPARE stmt_rb_ss_fk;

SET @rb_ss_idx = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_services' AND INDEX_NAME = 'idx_section_services_service') = 0,
    'SELECT 1',
    'ALTER TABLE section_services DROP INDEX idx_section_services_service'
);
PREPARE stmt_rb_ss_idx FROM @rb_ss_idx;
EXECUTE stmt_rb_ss_idx;
DEALLOCATE PREPARE stmt_rb_ss_idx;

SET @rb_ss_col = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_services' AND COLUMN_NAME = 'service_id') = 0,
    'SELECT 1',
    'ALTER TABLE section_services DROP COLUMN service_id'
);
PREPARE stmt_rb_ss_col FROM @rb_ss_col;
EXECUTE stmt_rb_ss_col;
DEALLOCATE PREPARE stmt_rb_ss_col;

SET @rb_es_fk = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimate_sections'
        AND CONSTRAINT_NAME = 'fk_estimate_sections_category' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
    'SELECT 1',
    'ALTER TABLE estimate_sections DROP FOREIGN KEY fk_estimate_sections_category'
);
PREPARE stmt_rb_es_fk FROM @rb_es_fk;
EXECUTE stmt_rb_es_fk;
DEALLOCATE PREPARE stmt_rb_es_fk;

SET @rb_es_idx = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimate_sections' AND INDEX_NAME = 'idx_estimate_sections_category') = 0,
    'SELECT 1',
    'ALTER TABLE estimate_sections DROP INDEX idx_estimate_sections_category'
);
PREPARE stmt_rb_es_idx FROM @rb_es_idx;
EXECUTE stmt_rb_es_idx;
DEALLOCATE PREPARE stmt_rb_es_idx;

SET @rb_es_col = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimate_sections' AND COLUMN_NAME = 'service_category_id') = 0,
    'SELECT 1',
    'ALTER TABLE estimate_sections DROP COLUMN service_category_id'
);
PREPARE stmt_rb_es_col FROM @rb_es_col;
EXECUTE stmt_rb_es_col;
DEALLOCATE PREPARE stmt_rb_es_col;

SET @rb_svc_uq_aspire = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services'
        AND INDEX_NAME = 'uq_services_aspire_service') = 0,
    'SELECT 1',
    'ALTER TABLE services DROP INDEX uq_services_aspire_service'
);
PREPARE stmt_rb_svc_uq_aspire FROM @rb_svc_uq_aspire;
EXECUTE stmt_rb_svc_uq_aspire;
DEALLOCATE PREPARE stmt_rb_svc_uq_aspire;

DROP TABLE IF EXISTS service_default_items;
DROP TABLE IF EXISTS service_kit_links;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS service_categories;

SET @rb_m_fulltext = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND INDEX_NAME = 'ft_materials_description_alt') = 0,
    'SELECT 1',
    'ALTER TABLE materials DROP INDEX ft_materials_description_alt'
);
PREPARE stmt_rb_m_fulltext FROM @rb_m_fulltext;
EXECUTE stmt_rb_m_fulltext;
DEALLOCATE PREPARE stmt_rb_m_fulltext;

SET @clear_073 = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'schema_migrations'
        AND COLUMN_NAME = 'id') = 0,
    'SELECT 1',
    'DELETE FROM schema_migrations WHERE id = ''073_service_catalog'''
);
PREPARE stmt_clear_073 FROM @clear_073;
EXECUTE stmt_clear_073;
DEALLOCATE PREPARE stmt_clear_073;
