-- ---------------------------------------------------------------------------
-- Migration 040 — add `proposal_requests.chapter_order`.
--
-- Backs the table-of-contents + chapter reorder feature: a rep can drag whole
-- chapters (groups of one or more consecutive pages) into a custom order from
-- the interactive preview, and both /proposals/:id/preview and the headless
-- /proposals/:id/print route (what the server-side PDF render screenshots)
-- read the same persisted order, so a saved rearrangement actually reaches
-- the generated PDF.
--
-- NULL means "no custom order saved yet — use the natural default order",
-- distinct from an empty array (which would be meaningless here and should
-- never occur). Same NULL-vs-populated convention as
-- proposal_renders.overflowing_pages from migration 028.
--
-- Detector keys on its own effect (`proposal_requests.chapter_order`), guarded
-- via the dynamic PREPARE/EXECUTE information_schema pattern (mirrors
-- 027/028/031/038) so the file is safe to re-run.
-- ---------------------------------------------------------------------------

SET @add_chapter_order = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'proposal_requests'
       AND column_name  = 'chapter_order') > 0,
    'SELECT 1',
    'ALTER TABLE `proposal_requests` ADD COLUMN `chapter_order` TEXT DEFAULT NULL COMMENT ''JSON: string[] of chapter keys, body chapters only (excludes cover/intro/closing). NULL = natural order.'''
);
PREPARE stmt_add_chapter_order FROM @add_chapter_order;
EXECUTE stmt_add_chapter_order;
DEALLOCATE PREPARE stmt_add_chapter_order;
