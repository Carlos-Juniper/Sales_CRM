-- ---------------------------------------------------------------------------
-- Migration 038 — add the missing `leads.handoff_notes` column.
--
-- Root cause: PATCH /api/leads/{id} (api/server.py `_PATCHABLE`/`_LEAD_TYPES`)
-- and the frontend's "Assign to CRM" flow (studio/src/api/leads.ts,
-- AssignCrmModal.tsx) have referenced `handoff_notes` on `leads` since that
-- feature was written, but no migration ever created the column — 500s with
-- pymysql (1054, "Unknown column 'handoff_notes' in 'field list'") on every
-- assignment attempt. `SHOW COLUMNS FROM leads` confirms it has never existed.
--
-- Detector keys on its own effect (`leads.handoff_notes`), guarded via the
-- dynamic PREPARE/EXECUTE information_schema pattern (mirrors 027/028/031) so
-- the file is safe to re-run.
-- ---------------------------------------------------------------------------

SET @add_handoff_notes = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'leads'
       AND column_name  = 'handoff_notes') > 0,
    'SELECT 1',
    'ALTER TABLE `leads` ADD COLUMN `handoff_notes` TEXT DEFAULT NULL'
);
PREPARE stmt_add_handoff_notes FROM @add_handoff_notes;
EXECUTE stmt_add_handoff_notes;
DEALLOCATE PREPARE stmt_add_handoff_notes;
