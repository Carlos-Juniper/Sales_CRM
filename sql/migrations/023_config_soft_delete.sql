-- ---------------------------------------------------------------------------
-- Migration 023 — Soft-delete parity for portfolio_properties and
--                 insurance_certificates (Handoff 38, follow-up task #18).
--
-- Both tables were created in migration 014 without an `active` column, so
-- their DELETE endpoints emitted hard DELETEs — inconsistent with every other
-- config table (team_members, client_references, licenses_certifications) that
-- uses active=0 soft-delete.
--
-- This migration adds `active TINYINT(1) NOT NULL DEFAULT 1` to both tables
-- and indexes each column for the list-endpoint filter (WHERE active = 1).
-- The column defaults to 1 so all existing rows remain visible after apply.
--
-- After this migration, api/settings.py converts the DELETE handlers to:
--   UPDATE ... SET active = 0 WHERE id = %s
-- and the list endpoints add: WHERE active = 1 (default) with an
-- include_inactive / include_expired toggle.
--
-- Guard pattern: information_schema check inside PREPARE so the statement is
-- idempotent (same pattern as migration 014).
-- ---------------------------------------------------------------------------

-- portfolio_properties.active ------------------------------------------------
SET @add_pp_active = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'portfolio_properties'
       AND column_name  = 'active') > 0,
    'SELECT 1',
    'ALTER TABLE `portfolio_properties` ADD COLUMN `active` TINYINT(1) NOT NULL DEFAULT 1'
);
PREPARE stmt_pp_active FROM @add_pp_active;
EXECUTE stmt_pp_active;
DEALLOCATE PREPARE stmt_pp_active;

SET @add_pp_idx = IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name   = 'portfolio_properties'
       AND index_name   = 'idx_portfolio_active') > 0,
    'SELECT 1',
    'ALTER TABLE `portfolio_properties` ADD INDEX idx_portfolio_active (active)'
);
PREPARE stmt_pp_idx FROM @add_pp_idx;
EXECUTE stmt_pp_idx;
DEALLOCATE PREPARE stmt_pp_idx;

-- insurance_certificates.active ----------------------------------------------
SET @add_ins_active = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'insurance_certificates'
       AND column_name  = 'active') > 0,
    'SELECT 1',
    'ALTER TABLE `insurance_certificates` ADD COLUMN `active` TINYINT(1) NOT NULL DEFAULT 1'
);
PREPARE stmt_ins_active FROM @add_ins_active;
EXECUTE stmt_ins_active;
DEALLOCATE PREPARE stmt_ins_active;

SET @add_ins_idx = IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name   = 'insurance_certificates'
       AND index_name   = 'idx_insurance_active') > 0,
    'SELECT 1',
    'ALTER TABLE `insurance_certificates` ADD INDEX idx_insurance_active (active)'
);
PREPARE stmt_ins_idx FROM @add_ins_idx;
EXECUTE stmt_ins_idx;
DEALLOCATE PREPARE stmt_ins_idx;
