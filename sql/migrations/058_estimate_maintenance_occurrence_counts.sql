-- ---------------------------------------------------------------------------
-- Migration 058 — yearly maintenance service occurrence counts.
--
-- The maintenance intake form replaces the free-text scope-of-work box with
-- six structured visit counts (occurrences per year). Each is a nullable
-- non-negative INT on estimates, same shape as other optional intake numbers:
-- NULL means the rep left it blank, 0 means the service is not in the contract.
-- The API rejects values outside 0..366 (one visit on every day of a leap year).
--
-- scope-of-work text already stored in intake_submissions.payload is left
-- in place. This migration does not drop or rewrite that JSON.
--
-- Idempotent: every ADD is information_schema-guarded (041 pattern). The
-- runner detector keys on irrigation_occurrences, the last column added.
-- ---------------------------------------------------------------------------

SET @add_mowing_occurrences = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'estimates'
       AND column_name  = 'mowing_occurrences') > 0,
    'SELECT 1',
    'ALTER TABLE `estimates` ADD COLUMN `mowing_occurrences` INT NULL DEFAULT NULL COMMENT ''Yearly mowing visits. NULL if unanswered.'''
);
PREPARE stmt_add_mowing_occurrences FROM @add_mowing_occurrences;
EXECUTE stmt_add_mowing_occurrences;
DEALLOCATE PREPARE stmt_add_mowing_occurrences;

SET @add_pruning_occurrences = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'estimates'
       AND column_name  = 'pruning_occurrences') > 0,
    'SELECT 1',
    'ALTER TABLE `estimates` ADD COLUMN `pruning_occurrences` INT NULL DEFAULT NULL COMMENT ''Yearly pruning visits. NULL if unanswered.'''
);
PREPARE stmt_add_pruning_occurrences FROM @add_pruning_occurrences;
EXECUTE stmt_add_pruning_occurrences;
DEALLOCATE PREPARE stmt_add_pruning_occurrences;

SET @add_turf_fert_occurrences = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'estimates'
       AND column_name  = 'turf_fert_occurrences') > 0,
    'SELECT 1',
    'ALTER TABLE `estimates` ADD COLUMN `turf_fert_occurrences` INT NULL DEFAULT NULL COMMENT ''Yearly turf fertilization visits. NULL if unanswered.'''
);
PREPARE stmt_add_turf_fert_occurrences FROM @add_turf_fert_occurrences;
EXECUTE stmt_add_turf_fert_occurrences;
DEALLOCATE PREPARE stmt_add_turf_fert_occurrences;

SET @add_shrub_fert_occurrences = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'estimates'
       AND column_name  = 'shrub_fert_occurrences') > 0,
    'SELECT 1',
    'ALTER TABLE `estimates` ADD COLUMN `shrub_fert_occurrences` INT NULL DEFAULT NULL COMMENT ''Yearly shrub fertilization visits. NULL if unanswered.'''
);
PREPARE stmt_add_shrub_fert_occurrences FROM @add_shrub_fert_occurrences;
EXECUTE stmt_add_shrub_fert_occurrences;
DEALLOCATE PREPARE stmt_add_shrub_fert_occurrences;

SET @add_ipm_occurrences = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'estimates'
       AND column_name  = 'ipm_occurrences') > 0,
    'SELECT 1',
    'ALTER TABLE `estimates` ADD COLUMN `ipm_occurrences` INT NULL DEFAULT NULL COMMENT ''Yearly integrated pest management visits. NULL if unanswered.'''
);
PREPARE stmt_add_ipm_occurrences FROM @add_ipm_occurrences;
EXECUTE stmt_add_ipm_occurrences;
DEALLOCATE PREPARE stmt_add_ipm_occurrences;

SET @add_irrigation_occurrences = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'estimates'
       AND column_name  = 'irrigation_occurrences') > 0,
    'SELECT 1',
    'ALTER TABLE `estimates` ADD COLUMN `irrigation_occurrences` INT NULL DEFAULT NULL COMMENT ''Yearly irrigation visits. NULL if unanswered.'''
);
PREPARE stmt_add_irrigation_occurrences FROM @add_irrigation_occurrences;
EXECUTE stmt_add_irrigation_occurrences;
DEALLOCATE PREPARE stmt_add_irrigation_occurrences;
