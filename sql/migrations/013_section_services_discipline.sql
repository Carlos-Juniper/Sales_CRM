-- ---------------------------------------------------------------------------
-- Migration 013 — Handoff 29 (ITB EST LS $ / EST IR $ Auto-Split by Discipline).
--
-- section_services.discipline — nullable per-line override of the auto-derived
-- landscape/irrigation classification used to split an ITB project's contract
-- value into est_ls_cents / est_ir_cents. NULL means "derive from the line's
-- catalog_items.service_type"; a non-NULL value always wins, which also covers
-- manual lines (catalog_item_id IS NULL) that have no service_type to derive
-- from — those default to landscape unless overridden here.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- ---------------------------------------------------------------------------

ALTER TABLE section_services
    ADD COLUMN discipline ENUM('landscape', 'irrigation') DEFAULT NULL AFTER catalog_item_id;

-- juniper-schema variant:
--   ALTER TABLE juniper.section_services
--       ADD COLUMN discipline ENUM('landscape', 'irrigation') DEFAULT NULL AFTER catalog_item_id;
