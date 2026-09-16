-- ---------------------------------------------------------------------------
-- Migration 046 — Per-line billing type override (Contract Generator).
--
-- section_services.billing_type — nullable per-line override of the billing
-- classification the contract generator uses to split CONTRACT SUMMARY rows
-- into recurring (spread across the 12-month PAYMENT SCHEDULE) and one-time
-- (billed when performed).
--
-- Until now billing_type was readable ONLY from the line's catalog item, so a
-- hand-entered line (catalog_item_id IS NULL) resolved to NULL and silently
-- dropped out of the payment-schedule base. NULL here still means "derive from
-- catalog_items.billing_type"; a non-NULL value always wins, which lets an
-- estimator file a manual line under the right category on the contract.
--
-- Mirrors 013_section_services_discipline, the same override pattern for the
-- ITB landscape/irrigation split.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- Applied by scripts/migrate.py (detect_046 keys on the column's existence).
-- ---------------------------------------------------------------------------

ALTER TABLE section_services
    ADD COLUMN billing_type ENUM('recurring', 'one_time') DEFAULT NULL AFTER discipline;

-- juniper-schema variant:
--   ALTER TABLE juniper.section_services
--       ADD COLUMN billing_type ENUM('recurring', 'one_time') DEFAULT NULL AFTER discipline;
