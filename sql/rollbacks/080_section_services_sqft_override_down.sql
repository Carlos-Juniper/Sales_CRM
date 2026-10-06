-- Rollback for 080_section_services_sqft_override.sql (not applied by the runner).
-- Run by hand only after verifying no application code reads this column.
-- The last statement removes the schema_migrations row so the runner re-applies 080.
ALTER TABLE section_services DROP COLUMN square_feet;
DELETE FROM schema_migrations WHERE id = '080_section_services_sqft_override';
