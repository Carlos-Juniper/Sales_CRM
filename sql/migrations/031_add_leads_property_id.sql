-- ---------------------------------------------------------------------------
-- Migration 031 — Handoff 49: add the columns 001's steps 2 & 3 never ran.
--
-- Root cause (verified 2026-09-08 against the live `crm` DB): migration 001's
-- detector (detect_001) keyed on the `properties` TABLE existing. That table
-- existed for other reasons, so the runner marked 001 applied WITHOUT executing
-- its two unguarded `ALTER TABLE` steps. As a result these five schema effects
-- are missing in production:
--
--   leads.property_id                 → POST /api/leads 500s (1054)
--   leads index idx_property_id
--   hoa_properties.assigned_to        → PATCH /api/hoa-properties/{id} 500s (1054)
--   hoa_properties.contact_status
--   hoa_properties.last_contacted
--
-- This is a NEW forward migration — 001's history and its detector are left
-- untouched (see Handoff 49 §5 for why re-running 001 is the wrong repair).
--
-- Idempotency & portability: every ADD is guarded on information_schema with the
-- dynamic PREPARE/EXECUTE pattern (mirrors 027/028). MySQL 8 has no
-- `ADD COLUMN IF NOT EXISTS`, and this file runs against environments in DIFFERENT
-- states — some had 001 apply correctly, some did not — so an unguarded ALTER
-- (the mistake that produced this handoff) is not acceptable here.
--
-- No `AFTER` clauses: 001 anchored on `raw_data` / `branch_id`, but column
-- position is cosmetic and those anchors may not be where 001 assumed. Do not
-- reintroduce a positional dependency.
--
-- No backfill: property_id is legitimately NULL for manual leads, and there is
-- no hoa_property_id data to derive it from.
-- ---------------------------------------------------------------------------

-- ── leads.property_id ──────────────────────────────────────────────────────
SET @add_lead_prop = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'leads'
       AND column_name  = 'property_id') > 0,
    'SELECT 1',
    'ALTER TABLE `leads` ADD COLUMN `property_id` VARCHAR(36) DEFAULT NULL'
);
PREPARE stmt_add_lead_prop FROM @add_lead_prop;
EXECUTE stmt_add_lead_prop;
DEALLOCATE PREPARE stmt_add_lead_prop;

-- ── leads index idx_property_id ────────────────────────────────────────────
SET @add_lead_idx = IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name   = 'leads'
       AND index_name   = 'idx_property_id') > 0,
    'SELECT 1',
    'ALTER TABLE `leads` ADD INDEX `idx_property_id` (`property_id`)'
);
PREPARE stmt_add_lead_idx FROM @add_lead_idx;
EXECUTE stmt_add_lead_idx;
DEALLOCATE PREPARE stmt_add_lead_idx;

-- ── hoa_properties.assigned_to ─────────────────────────────────────────────
SET @add_hoa_assigned = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'hoa_properties'
       AND column_name  = 'assigned_to') > 0,
    'SELECT 1',
    'ALTER TABLE `hoa_properties` ADD COLUMN `assigned_to` VARCHAR(255) DEFAULT NULL'
);
PREPARE stmt_add_hoa_assigned FROM @add_hoa_assigned;
EXECUTE stmt_add_hoa_assigned;
DEALLOCATE PREPARE stmt_add_hoa_assigned;

-- ── hoa_properties.contact_status ──────────────────────────────────────────
SET @add_hoa_status = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'hoa_properties'
       AND column_name  = 'contact_status') > 0,
    'SELECT 1',
    'ALTER TABLE `hoa_properties` ADD COLUMN `contact_status` VARCHAR(50) DEFAULT NULL'
);
PREPARE stmt_add_hoa_status FROM @add_hoa_status;
EXECUTE stmt_add_hoa_status;
DEALLOCATE PREPARE stmt_add_hoa_status;

-- ── hoa_properties.last_contacted ──────────────────────────────────────────
SET @add_hoa_contacted = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'hoa_properties'
       AND column_name  = 'last_contacted') > 0,
    'SELECT 1',
    'ALTER TABLE `hoa_properties` ADD COLUMN `last_contacted` DATE DEFAULT NULL'
);
PREPARE stmt_add_hoa_contacted FROM @add_hoa_contacted;
EXECUTE stmt_add_hoa_contacted;
DEALLOCATE PREPARE stmt_add_hoa_contacted;
