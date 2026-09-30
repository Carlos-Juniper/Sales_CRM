-- ---------------------------------------------------------------------------
-- Rollback for 071_item_classes.sql
--
-- scripts/migrate.py does not run files outside sql/migrations/. Apply by
-- hand:
--
--   mysql ... crm < sql/rollbacks/071_item_classes_down.sql
--
-- Drops item_classes and item_class_groups (and the loaded class list) and
-- deletes this file's schema_migrations row so the runner applies 071
-- again. materials is not touched. Statements are idempotent.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS item_classes;
DROP TABLE IF EXISTS item_class_groups;

SET @clear_071 = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'schema_migrations'
        AND COLUMN_NAME = 'id') = 0,
    'SELECT 1',
    'DELETE FROM schema_migrations WHERE id = ''071_item_classes'''
);
PREPARE stmt_clear_071 FROM @clear_071;
EXECUTE stmt_clear_071;
DEALLOCATE PREPARE stmt_clear_071;
