-- Rollback for 075_maintenance_service_catalog.sql (not applied by the runner).
-- Run by hand only after removing any section_services / estimate_sections
-- references to maintenance services and categories. The last statement
-- removes the schema_migrations row so the runner re-applies 075.
ALTER TABLE services DROP COLUMN occurrence_source;
ALTER TABLE service_kit_links DROP COLUMN sort_order;
DELETE FROM service_categories
 WHERE estimate_type = 'maintenance'
   AND id IN ('maint-cat-turf', 'maint-cat-bed_maint', 'maint-cat-irrigation',
              'maint-cat-fertilizer', 'maint-cat-pest_control', 'maint-cat-optional');
DELETE FROM schema_migrations WHERE id = '075_maintenance_service_catalog';
