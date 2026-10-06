-- Rollback for 079_service_kits_markup_columns.sql (not applied by the runner).
-- Run by hand only after verifying no application code reads these columns.
-- The last statement removes the schema_migrations row so the runner re-applies 079.
ALTER TABLE service_kits DROP COLUMN is_primary;
ALTER TABLE service_kits DROP COLUMN material_uom;
ALTER TABLE service_kits DROP COLUMN material_qty_per_unit;
ALTER TABLE service_kits DROP COLUMN material_unit_cost_cents;
ALTER TABLE service_kits DROP COLUMN material_markup_pct;
ALTER TABLE service_kits DROP COLUMN labor_markup_pct;
DELETE FROM schema_migrations WHERE id = '079_service_kits_markup_columns';
