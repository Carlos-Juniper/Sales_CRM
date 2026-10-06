-- Migration 080 — section_services per-line square_feet override
-- NULL = inherit estimate_sections.square_feet; typed value = override.
-- Allows the estimator to split total area across mower types (e.g., 80%
-- Standard 48", 20% Push 21") without zone-level restructuring.
--
-- Handoff 59 Track B. Adds a single nullable DECIMAL(12,2) column to
-- section_services. The seeder in api/maintenance_catalog.py writes NULL
-- for the primary mowing kit (inherits section square_feet) and 0 for every
-- other method row (pruning/fert/pest/irrigation areas are entered separately).
--
-- detect_080 keys on square_feet existing on section_services.
-- A re-run after a partial apply is safe: the PREPARE guard is a no-op when
-- the column already exists.
--
-- Rollback: sql/rollbacks/080_section_services_sqft_override_down.sql
-- ---------------------------------------------------------------------------

-- ── section_services.square_feet ────────────────────────────────────────────
SET @ss_add_square_feet = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_services'
        AND COLUMN_NAME = 'square_feet') > 0,
    'SELECT 1',
    'ALTER TABLE section_services ADD COLUMN square_feet DECIMAL(12,2) DEFAULT NULL AFTER billing_type'
);
PREPARE stmt_ss_add_square_feet FROM @ss_add_square_feet;
EXECUTE stmt_ss_add_square_feet;
DEALLOCATE PREPARE stmt_ss_add_square_feet;
