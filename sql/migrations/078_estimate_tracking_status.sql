-- ---------------------------------------------------------------------------
-- Migration 078 — tracking_status + tracker_comment on estimates.
--
-- Handoff 54 §8. Adds two nullable columns used by the Maintenance Estimating
-- Tracker page to track per-estimate progress independently of the core
-- workflow status:
--
--   1. tracking_status  — ENUM of nine tracker states (not_started …
--                         completed). NULL until the manager sets one.
--   2. tracker_comment  — free-text manager note, NULL by default.
--
-- Both columns are NULL DEFAULT NULL so all existing rows are unaffected.
-- Every ALTER statement is information_schema-guarded (PREPARE/EXECUTE pattern)
-- so a re-run after a partial apply completes the remainder safely.
--
-- tracker_comment is LAST; detect_078 keys on tracking_status (the sentinel
-- column for this migration).
--
-- No triggers, functions, procedures or generated columns: Cloud SQL runs
-- with binlog on and the migration user has no SUPER (ERROR 1419).
--
-- Rollback: DROP COLUMN tracking_status; DROP COLUMN tracker_comment;
-- ---------------------------------------------------------------------------

-- ── 1. tracking_status ──────────────────────────────────────────────────────
SET @add_tracking_status = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates'
        AND COLUMN_NAME = 'tracking_status') > 0,
    'SELECT 1',
    "ALTER TABLE estimates ADD COLUMN tracking_status ENUM('not_started','in_progress','drafted','ai_scanning','takeoff_comp','on_hold','passed','delivered','completed') NULL DEFAULT NULL"
);
PREPARE stmt_add_tracking_status FROM @add_tracking_status;
EXECUTE stmt_add_tracking_status;
DEALLOCATE PREPARE stmt_add_tracking_status;

-- ── 2. tracker_comment — LAST, detect_078 keys on tracking_status ───────────
SET @add_tracker_comment = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates'
        AND COLUMN_NAME = 'tracker_comment') > 0,
    'SELECT 1',
    'ALTER TABLE estimates ADD COLUMN tracker_comment TEXT NULL DEFAULT NULL'
);
PREPARE stmt_add_tracker_comment FROM @add_tracker_comment;
EXECUTE stmt_add_tracker_comment;
DEALLOCATE PREPARE stmt_add_tracker_comment;
