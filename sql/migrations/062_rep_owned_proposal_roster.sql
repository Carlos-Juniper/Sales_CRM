-- ---------------------------------------------------------------------------
-- Migration 062 — Per-rep ownership of client references and the team roster.
--
-- Numbered 062. 058 is PR #25's number, and 059, 060, and 061 are reserved
-- by the S2, S4, and S1 PRs. The role split itself adds no DDL (users.role
-- is VARCHAR). This file is the roster owner-column change integrated from
-- #25. Every statement is information_schema-guarded, so if #25's 058
-- already added these columns this file is a no-op.
--
-- The shared portfolio stays one company-wide set (no owner column).
-- client_references and team_members gain owner_user_id (users.id of the
-- sales rep the row belongs to). NULL keeps a legacy company/branch row on
-- its existing branch-manager / marketing access. Sales-rep creates, and
-- marketing/admin creates that pass rep_id, store that rep's id.
--
-- Guard pattern: information_schema check inside PREPARE so each statement
-- is idempotent (same pattern as migration 014 / 023).
-- ---------------------------------------------------------------------------

-- team_members.owner_user_id -------------------------------------------------
SET @add_tm_owner = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'team_members'
       AND column_name  = 'owner_user_id') > 0,
    'SELECT 1',
    'ALTER TABLE `team_members` ADD COLUMN `owner_user_id` VARCHAR(36) NULL DEFAULT NULL'
);
PREPARE stmt_tm_owner FROM @add_tm_owner;
EXECUTE stmt_tm_owner;
DEALLOCATE PREPARE stmt_tm_owner;

SET @add_tm_owner_idx = IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name   = 'team_members'
       AND index_name   = 'idx_team_members_owner') > 0,
    'SELECT 1',
    'ALTER TABLE `team_members` ADD INDEX idx_team_members_owner (owner_user_id)'
);
PREPARE stmt_tm_owner_idx FROM @add_tm_owner_idx;
EXECUTE stmt_tm_owner_idx;
DEALLOCATE PREPARE stmt_tm_owner_idx;

-- client_references.owner_user_id --------------------------------------------
SET @add_cr_owner = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'client_references'
       AND column_name  = 'owner_user_id') > 0,
    'SELECT 1',
    'ALTER TABLE `client_references` ADD COLUMN `owner_user_id` VARCHAR(36) NULL DEFAULT NULL'
);
PREPARE stmt_cr_owner FROM @add_cr_owner;
EXECUTE stmt_cr_owner;
DEALLOCATE PREPARE stmt_cr_owner;

SET @add_cr_owner_idx = IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name   = 'client_references'
       AND index_name   = 'idx_client_refs_owner') > 0,
    'SELECT 1',
    'ALTER TABLE `client_references` ADD INDEX idx_client_refs_owner (owner_user_id)'
);
PREPARE stmt_cr_owner_idx FROM @add_cr_owner_idx;
EXECUTE stmt_cr_owner_idx;
DEALLOCATE PREPARE stmt_cr_owner_idx;
