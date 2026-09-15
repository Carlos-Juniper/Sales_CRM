-- ---------------------------------------------------------------------------
-- Migration 034 — WS2: Estimate-optional proposals + lead-scoped uploads
--
-- Two schema changes:
--
--   1. proposal_requests.estimate_id — make nullable so a proposal can be
--      generated before an estimate is approved (or even created).
--
--   2. intake_attachments.lead_id — new nullable column that allows proposal
--      document uploads (proposal_contract, proposal_measurements,
--      proposal_other) to be anchored to a lead when no estimate exists yet.
--      When an estimate is later linked via POST /api/proposals the backend
--      re-anchors these rows by setting estimate_id = <estimate_id> in the
--      same transaction (Option C, WS2 §3).
--
-- Idempotency: both steps use PREPARE/EXECUTE guards (the pattern from 033).
-- Running this migration twice is safe.
-- ---------------------------------------------------------------------------

-- ── Step 1: Make proposal_requests.estimate_id nullable ──────────────────────

SET @make_nullable = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'proposal_requests'
       AND COLUMN_NAME  = 'estimate_id'
       AND IS_NULLABLE  = 'YES') > 0,
    'SELECT 1',
    'ALTER TABLE `proposal_requests` MODIFY estimate_id VARCHAR(36) NULL'
);
PREPARE stmt_nullable FROM @make_nullable;
EXECUTE stmt_nullable;
DEALLOCATE PREPARE stmt_nullable;


-- ── Step 2: Add intake_attachments.lead_id column ────────────────────────────

SET @add_lead_id = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'intake_attachments'
       AND COLUMN_NAME  = 'lead_id') > 0,
    'SELECT 1',
    'ALTER TABLE `intake_attachments` ADD COLUMN `lead_id` VARCHAR(36) NULL AFTER `estimate_id`'
);
PREPARE stmt_add_lead_id FROM @add_lead_id;
EXECUTE stmt_add_lead_id;
DEALLOCATE PREPARE stmt_add_lead_id;


-- ── Step 3: Add index on intake_attachments.lead_id ──────────────────────────

SET @add_idx = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'intake_attachments'
       AND INDEX_NAME   = 'idx_ia_lead_id') > 0,
    'SELECT 1',
    'ALTER TABLE `intake_attachments` ADD INDEX `idx_ia_lead_id` (`lead_id`)'
);
PREPARE stmt_add_idx FROM @add_idx;
EXECUTE stmt_add_idx;
DEALLOCATE PREPARE stmt_add_idx;
