-- ---------------------------------------------------------------------------
-- Migration 059 — nullable contract-structure budgets.
--
-- Maintenance intake's split contract structure captures a Homes budget and a
-- Common area budget (dollars). Reps usually do not know these numbers, so
-- both columns are nullable: omitted or blank is NULL (unknown), which stays
-- distinct from a known 0.
--
-- The columns do not exist yet (they are not already nullable). This file
-- adds them as NULL, and also MODIFYs them to NULL if a partial apply left
-- them NOT NULL. Detector keys on both columns being nullable — its own
-- effect. Every statement is information_schema-guarded (mirrors 040/041).
-- ---------------------------------------------------------------------------

SET @homes_budget_ddl = (
    SELECT CASE
        WHEN COUNT(*) = 0 THEN
            'ALTER TABLE `estimates` ADD COLUMN `homes_budget` DECIMAL(15,2) NULL DEFAULT NULL COMMENT ''Homes budget in dollars for a split contract. NULL = unknown, distinct from 0.'''
        WHEN MAX(IS_NULLABLE) = 'NO' THEN
            'ALTER TABLE `estimates` MODIFY COLUMN `homes_budget` DECIMAL(15,2) NULL DEFAULT NULL COMMENT ''Homes budget in dollars for a split contract. NULL = unknown, distinct from 0.'''
        ELSE 'SELECT 1'
    END
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'estimates'
      AND column_name = 'homes_budget'
);
PREPARE stmt_homes_budget FROM @homes_budget_ddl;
EXECUTE stmt_homes_budget;
DEALLOCATE PREPARE stmt_homes_budget;

SET @common_area_budget_ddl = (
    SELECT CASE
        WHEN COUNT(*) = 0 THEN
            'ALTER TABLE `estimates` ADD COLUMN `common_area_budget` DECIMAL(15,2) NULL DEFAULT NULL COMMENT ''Common area budget in dollars for a split contract. NULL = unknown, distinct from 0.'''
        WHEN MAX(IS_NULLABLE) = 'NO' THEN
            'ALTER TABLE `estimates` MODIFY COLUMN `common_area_budget` DECIMAL(15,2) NULL DEFAULT NULL COMMENT ''Common area budget in dollars for a split contract. NULL = unknown, distinct from 0.'''
        ELSE 'SELECT 1'
    END
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'estimates'
      AND column_name = 'common_area_budget'
);
PREPARE stmt_common_area_budget FROM @common_area_budget_ddl;
EXECUTE stmt_common_area_budget;
DEALLOCATE PREPARE stmt_common_area_budget;
