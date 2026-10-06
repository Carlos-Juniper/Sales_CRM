-- Migration 081: add is_primary, labor_markup_pct, material_markup_pct to service_kit_links
-- These columns allow per-link markup overrides and primary-method designation,
-- mirroring the pull_aspire_service_catalog seed output.

SET @db = DATABASE();
SET @tbl = 'service_kit_links';

-- is_primary
SET @col = 'is_primary';
SET @stmt = IF(
    NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = @db AND table_name = @tbl AND column_name = @col
    ),
    CONCAT('ALTER TABLE ', @db, '.', @tbl,
           ' ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 0'),
    'SELECT 1'
);
PREPARE _s FROM @stmt; EXECUTE _s; DEALLOCATE PREPARE _s;

-- labor_markup_pct
SET @col = 'labor_markup_pct';
SET @stmt = IF(
    NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = @db AND table_name = @tbl AND column_name = @col
    ),
    CONCAT('ALTER TABLE ', @db, '.', @tbl,
           ' ADD COLUMN labor_markup_pct DECIMAL(6,2) DEFAULT NULL'),
    'SELECT 1'
);
PREPARE _s FROM @stmt; EXECUTE _s; DEALLOCATE PREPARE _s;

-- material_markup_pct
SET @col = 'material_markup_pct';
SET @stmt = IF(
    NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = @db AND table_name = @tbl AND column_name = @col
    ),
    CONCAT('ALTER TABLE ', @db, '.', @tbl,
           ' ADD COLUMN material_markup_pct DECIMAL(6,2) DEFAULT NULL'),
    'SELECT 1'
);
PREPARE _s FROM @stmt; EXECUTE _s; DEALLOCATE PREPARE _s;

-- Registration is handled by the migration runner (scripts/migrate.py).
