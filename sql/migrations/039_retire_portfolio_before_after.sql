-- ---------------------------------------------------------------------------
-- Migration 039 — retire portfolio_properties.before_after_object_keys
--
-- Background: before_after_object_keys was added to portfolio_properties in
-- migration 014 (proposal config tables) as a speculative field for side-by-
-- side before/after imagery. The feature was never built out: every INSERT in
-- migrations 015 and 036 sets the column to NULL, and the API/frontend never
-- reads or writes it. Dropping it removes dead schema before it can confuse
-- future photo-handling work.
--
-- Steps:
--
--   §1 Data preservation guard — fold any non-NULL before_after_object_keys
--      value into photo_object_keys so no GCS references are lost.  Uses
--      JSON_CONTAINS to guard against double-append on re-run.  In practice
--      every current row has before_after_object_keys IS NULL (confirmed in
--      migrations 015 and 036), so this block is a safety net only.
--
--   §2 Column drop — uses the information_schema-guarded PREPARE/EXECUTE
--      pattern (mirrors 027/028/031/038) so the file is safe to re-run after
--      a partial apply or on a DB where the column is already absent.
--
-- Detection: detect_039 keys on the ABSENCE of the column — the migration's
-- own effect.  A True return means the DROP landed (or the column never
-- existed, which is equally safe).
-- ---------------------------------------------------------------------------


-- ── §1 Data preservation: fold before→photo_object_keys ─────────────────────
--
-- For rows that have a non-NULL before_after_object_keys JSON object and whose
-- 'before' key is not already in photo_object_keys, append the 'before' value.
-- The JSON_CONTAINS guard prevents double-append on re-run.
--
-- MySQL 5.7+ JSON_EXTRACT returns NULL when the path is absent, so
-- JSON_EXTRACT(..., '$.before') IS NOT NULL gates against missing sub-keys.

UPDATE portfolio_properties
   SET photo_object_keys = JSON_ARRAY_APPEND(
           photo_object_keys,
           '$',
           JSON_UNQUOTE(JSON_EXTRACT(before_after_object_keys, '$.before'))
       )
 WHERE before_after_object_keys IS NOT NULL
   AND JSON_EXTRACT(before_after_object_keys, '$.before') IS NOT NULL
   AND NOT JSON_CONTAINS(
           photo_object_keys,
           JSON_EXTRACT(before_after_object_keys, '$.before')
       );

-- For rows whose 'after' key is not already in photo_object_keys, append the
-- 'after' value.  Same re-run guard via JSON_CONTAINS.

UPDATE portfolio_properties
   SET photo_object_keys = JSON_ARRAY_APPEND(
           photo_object_keys,
           '$',
           JSON_UNQUOTE(JSON_EXTRACT(before_after_object_keys, '$.after'))
       )
 WHERE before_after_object_keys IS NOT NULL
   AND JSON_EXTRACT(before_after_object_keys, '$.after') IS NOT NULL
   AND NOT JSON_CONTAINS(
           photo_object_keys,
           JSON_EXTRACT(before_after_object_keys, '$.after')
       );


-- ── §2 Drop the column — information_schema-guarded PREPARE/EXECUTE ─────────

SET @col_exists = (
    SELECT COUNT(*)
      FROM information_schema.COLUMNS
     WHERE table_schema = DATABASE()
       AND table_name   = 'portfolio_properties'
       AND column_name  = 'before_after_object_keys'
);
SET @drop_sql = IF(
    @col_exists > 0,
    'ALTER TABLE `portfolio_properties` DROP COLUMN `before_after_object_keys`',
    'SELECT 1'
);
PREPARE stmt_drop_before_after FROM @drop_sql;
EXECUTE stmt_drop_before_after;
DEALLOCATE PREPARE stmt_drop_before_after;
