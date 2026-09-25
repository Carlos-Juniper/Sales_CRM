-- ---------------------------------------------------------------------------
-- Migration 066 — users.reports_to_user_id
--
-- Numbered 066. 065 is reserved for the open commissions PR so this file
-- does not collide with it. 064 on main is the maintenance occurrence
-- counts. Every statement is information_schema-guarded, so a re-run after
-- the column, index, or foreign key already exists is a no-op.
--
-- Regional Sales sees their own book plus the users who report to them.
-- The column is nullable: a field-sales user with no manager keeps NULL.
-- ON DELETE SET NULL so removing a Regional Sales user does not block
-- deleting that row and does not leave a dangling id.
-- ---------------------------------------------------------------------------

SET @add_reports_to = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'users'
       AND column_name  = 'reports_to_user_id') > 0,
    'SELECT 1',
    'ALTER TABLE `users` ADD COLUMN `reports_to_user_id` VARCHAR(36) NULL DEFAULT NULL'
);
PREPARE stmt_reports_to FROM @add_reports_to;
EXECUTE stmt_reports_to;
DEALLOCATE PREPARE stmt_reports_to;

SET @add_reports_to_idx = IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name   = 'users'
       AND index_name   = 'idx_users_reports_to') > 0,
    'SELECT 1',
    'ALTER TABLE `users` ADD INDEX idx_users_reports_to (reports_to_user_id)'
);
PREPARE stmt_reports_to_idx FROM @add_reports_to_idx;
EXECUTE stmt_reports_to_idx;
DEALLOCATE PREPARE stmt_reports_to_idx;

SET @add_reports_to_fk = IF(
    (SELECT COUNT(*) FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name   = 'users'
       AND constraint_name = 'fk_users_reports_to'
       AND constraint_type = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE `users` ADD CONSTRAINT `fk_users_reports_to` FOREIGN KEY (`reports_to_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);
PREPARE stmt_reports_to_fk FROM @add_reports_to_fk;
EXECUTE stmt_reports_to_fk;
DEALLOCATE PREPARE stmt_reports_to_fk;
