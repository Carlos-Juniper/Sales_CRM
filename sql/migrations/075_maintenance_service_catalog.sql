-- ---------------------------------------------------------------------------
-- Migration 075 — maintenance service catalog on the 073 tables.
--
-- Handoff 54 §1. 073 (Handoff 55) already created the shared catalog with the
-- maintenance columns riding along (service_categories.estimate_type,
-- is_optional, aspire_service_group_name; services.default_occurrences;
-- service_kit_links; section_services.service_id). This file adds only what
-- maintenance still needs:
--
--   1. The six maintenance service_categories rows: the five standard
--      Aspire OpportunityServiceGroups (Turf, Bed Maint, Irrigation,
--      Fertilizer, Pest Control) and Optional Services (is_optional = 1).
--      Deterministic ids maint-cat-<code>. Upsert keyed on
--      uq_service_categories_type_code; an existing row keeps its values.
--   2. service_kit_links.sort_order — the order a service's kits render in.
--   3. services.occurrence_source — which migration-064 yearly count on
--      estimates seeds the service's occurrences when Handoff 54 §2 seeds a
--      maintenance section (mowing_occurrences, pruning_occurrences,
--      turf_fert_occurrences, shrub_fert_occurrences, ipm_occurrences,
--      irrigation_occurrences). NULL = use services.default_occurrences.
--      The allowed values are checked in code (api/maintenance_catalog.py),
--      so adding a 064-style count later needs no DDL here.
--
-- No services or service_kit_links rows are written here. Those come from
-- scripts/pull_aspire_service_catalog.py, which pulls the live Aspire
-- catalog into a gitignored review folder and emits SQL that is applied only
-- after review (Carlos, 2026-10-01). service_kits is never touched.
--
-- No triggers, functions, procedures or generated columns: Cloud SQL runs
-- with binlog on and the migration user has no SUPER (ERROR 1419).
-- Every statement is upsert/information_schema-guarded, so a re-run after a
-- partial apply finishes the remainder. services.occurrence_source is LAST:
-- detect_075 keys on it (plus sort_order and the six rows).
--
-- Rollback (not applied by the runner): sql/rollbacks/075_maintenance_service_catalog_down.sql
-- ---------------------------------------------------------------------------

-- ── 1. maintenance categories ───────────────────────────────────────────────
INSERT INTO service_categories
    (id, code, name, estimate_type, sort_order, is_optional, aspire_service_group_name, item_class_codes, active)
VALUES
    ('maint-cat-turf',         'turf',         'Turf',              'maintenance', 10, 0, 'Turf',              NULL, 1),
    ('maint-cat-bed_maint',    'bed_maint',    'Bed Maint',         'maintenance', 20, 0, 'Bed Maint',         NULL, 1),
    ('maint-cat-irrigation',   'irrigation',   'Irrigation',        'maintenance', 30, 0, 'Irrigation',        NULL, 1),
    ('maint-cat-fertilizer',   'fertilizer',   'Fertilizer',        'maintenance', 40, 0, 'Fertilizer',        NULL, 1),
    ('maint-cat-pest_control', 'pest_control', 'Pest Control',      'maintenance', 50, 0, 'Pest Control',      NULL, 1),
    ('maint-cat-optional',     'optional',     'Optional Services', 'maintenance', 60, 1, 'Optional Services', NULL, 1)
ON DUPLICATE KEY UPDATE id = id;

-- ── 2. service_kit_links.sort_order ─────────────────────────────────────────
SET @skl_add_sort_order = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kit_links'
        AND COLUMN_NAME = 'sort_order') > 0,
    'SELECT 1',
    'ALTER TABLE service_kit_links ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER basis'
);
PREPARE stmt_skl_add_sort_order FROM @skl_add_sort_order;
EXECUTE stmt_skl_add_sort_order;
DEALLOCATE PREPARE stmt_skl_add_sort_order;

-- ── 3. services.occurrence_source — LAST, detect_075 keys here ──────────────
SET @svc_add_occurrence_source = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services'
        AND COLUMN_NAME = 'occurrence_source') > 0,
    'SELECT 1',
    'ALTER TABLE services ADD COLUMN occurrence_source VARCHAR(64) DEFAULT NULL AFTER default_occurrences'
);
PREPARE stmt_svc_add_occurrence_source FROM @svc_add_occurrence_source;
EXECUTE stmt_svc_add_occurrence_source;
DEALLOCATE PREPARE stmt_svc_add_occurrence_source;
