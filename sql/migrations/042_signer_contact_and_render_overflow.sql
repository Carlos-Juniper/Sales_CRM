-- ---------------------------------------------------------------------------
-- Migration 042 — Handoff 43 §3: signer contact columns + render overflow log
--
-- Three columns, two unrelated concerns, one file. They are batched because the
-- numbering space is contested (see the numbering-history note in README.md:
-- main and worktree-proposify both numbered from 014, and 027/028 are already
-- used by two other worktrees for the estimate↔proposal PDF link and the
-- documents unification). Every extra file is another number to reconcile at
-- merge time, so a single guarded file is the cheaper shape here.
--
-- ── 1. users.phone / users.title (§3.1) ────────────────────────────────────
-- The signer block on a client-facing proposal printed COMPANY_INFO.phone for
-- every rep and derived the job title from `role` through a hard-coded map,
-- because `users` carried neither column. A rep's direct line is the number a
-- client actually calls, so it has to be a per-user fact.
--
-- Both NULL-able with no default: an un-filled row must fall back to the
-- company line rather than print an empty field, and that decision belongs to
-- the resolver in api/proposals.py, not to a DB default.
--
-- ── 2. proposal_renders.overflowing_pages (§3.3) ────────────────────────────
-- The renderer already detects pages whose content was clipped by the fixed
-- 11in sheet and returns them on the render response, but nothing stored them,
-- so "which past proposals shipped with a paragraph missing" was unanswerable.
-- JSON, not a count: the page number and the overflow in px are what make a
-- clipped render actionable after the fact.
--
-- NULL is meaningful and distinct from '[]' — NULL means "this render predates
-- overflow detection", [] means "measured, nothing clipped". Any query that
-- treats them the same will mis-report every render before this migration.
--
-- Guard pattern: information_schema check inside PREPARE, so each statement is
-- idempotent (same pattern as migrations 014 and 023).
-- ---------------------------------------------------------------------------

-- users.phone ----------------------------------------------------------------
SET @add_users_phone = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'users'
       AND column_name  = 'phone') > 0,
    'SELECT 1',
    'ALTER TABLE `users` ADD COLUMN `phone` VARCHAR(32) NULL DEFAULT NULL'
);
PREPARE stmt_users_phone FROM @add_users_phone;
EXECUTE stmt_users_phone;
DEALLOCATE PREPARE stmt_users_phone;

-- users.title ----------------------------------------------------------------
SET @add_users_title = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'users'
       AND column_name  = 'title') > 0,
    'SELECT 1',
    'ALTER TABLE `users` ADD COLUMN `title` VARCHAR(120) NULL DEFAULT NULL'
);
PREPARE stmt_users_title FROM @add_users_title;
EXECUTE stmt_users_title;
DEALLOCATE PREPARE stmt_users_title;

-- proposal_renders.overflowing_pages -----------------------------------------
SET @add_render_overflow = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'proposal_renders'
       AND column_name  = 'overflowing_pages') > 0,
    'SELECT 1',
    'ALTER TABLE `proposal_renders` ADD COLUMN `overflowing_pages` JSON NULL DEFAULT NULL'
);
PREPARE stmt_render_overflow FROM @add_render_overflow;
EXECUTE stmt_render_overflow;
DEALLOCATE PREPARE stmt_render_overflow;
