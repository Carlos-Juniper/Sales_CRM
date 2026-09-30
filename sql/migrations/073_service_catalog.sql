-- ---------------------------------------------------------------------------
-- Migration 073 — service catalog: section and service dimensions.
--
-- Handoff 55 §1. Creates the catalog both estimate types share (D3):
--
--   service_categories   level 1: the section an estimator picks
--                        (Landscape, Irrigation, ...). estimate_type
--                        discriminates install from maintenance.
--   services             level 2: Aspire's canonical Services (D1), e.g.
--                        IN: Irrigation Install, keyed by aspire_service_id.
--   service_kit_links    service -> service_kits. Written by Handoff 54 §1
--                        for maintenance. Install writes no rows (D1).
--   service_default_items  the D2 template copied into
--                        section_service_components when a service is added.
--
-- Plus: section_services.service_id and estimate_sections.service_category_id
-- (nullable FKs), and a FULLTEXT index on materials (description,
-- alternate_name) for GET /api/estimating/materials (§2). That index is the
-- only change to the materials workstream's tables. No materials,
-- material_prices, item_classes or item_class_groups row is written.
--
-- Maintenance's columns ride along from the start (estimate_type,
-- is_optional, aspire_service_group_name, services.default_occurrences,
-- service_kit_links) so Handoff 54 needs no DDL of its own. Handoff 54's
-- later migrations renumber to 075/076/077 (074 is Handoff 55 §5).
--
-- This file creates the tables empty. The install rows come from
-- scripts/load_service_catalog.py, which reads the checked-in Aspire extract
-- scripts/data/aspire_install_service_catalog.json.
--
-- No triggers, functions, procedures or generated columns: Cloud SQL runs
-- with binlog on and the migration user has no SUPER (ERROR 1419).
--
-- Every statement is information_schema-guarded or IF NOT EXISTS, so a
-- re-run after a partial apply finishes the remainder. service_default_items
-- and its service_kits FK are created LAST: detect_073 keys on them, so a
-- True detection means every earlier statement already landed.
--
-- Columns that reference the new tables from existing tables carry an
-- explicit CHARACTER SET / COLLATE, so they match services.id and
-- service_categories.id whatever the host table's default is.
--
-- Rollback (not applied by the runner): sql/rollbacks/073_service_catalog_down.sql
-- ---------------------------------------------------------------------------

-- ── 1. service_categories (level 1) ─────────────────────────────────────────
-- code is stable per estimate_type (landscape, irrigation, ...). name is
-- what lands in estimate_sections.name. item_class_codes is the §2 soft
-- prefilter: a JSON array of item_classes.code values (601, 606, ...), NULL
-- for unfiltered and for maintenance.
CREATE TABLE IF NOT EXISTS service_categories (
    id                         VARCHAR(36)  NOT NULL,
    code                       VARCHAR(64)  NOT NULL,
    name                       VARCHAR(128) NOT NULL,
    estimate_type              ENUM('maintenance','install') NOT NULL,
    sort_order                 INT          NOT NULL DEFAULT 0,
    is_optional                TINYINT(1)   NOT NULL DEFAULT 0,
    aspire_service_group_name  VARCHAR(255) DEFAULT NULL,
    item_class_codes           JSON         DEFAULT NULL,
    active                     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_service_categories_type_code (estimate_type, code),
    KEY idx_service_categories_type_sort (estimate_type, active, sort_order),
    CONSTRAINT chk_service_categories_code CHECK (code <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. services (level 2) ───────────────────────────────────────────────────
-- name is the Aspire Service name verbatim (IN: Irrigation Install).
-- default_occurrences is maintenance's (Handoff 54 §2); install leaves NULL.
CREATE TABLE IF NOT EXISTS services (
    id                   VARCHAR(36)  NOT NULL,
    service_category_id  VARCHAR(36)  NOT NULL,
    name                 VARCHAR(255) NOT NULL,
    display_name         VARCHAR(255) NOT NULL,
    sort_order           INT          NOT NULL DEFAULT 0,
    default_occurrences  INT          DEFAULT NULL,
    aspire_service_id    BIGINT       DEFAULT NULL,
    active               TINYINT(1)   NOT NULL DEFAULT 1,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_services_category_sort (service_category_id, active, sort_order),
    KEY idx_services_aspire_service (aspire_service_id),
    CONSTRAINT fk_services_category
        FOREIGN KEY (service_category_id) REFERENCES service_categories (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. service_kit_links ────────────────────────────────────────────────────
-- Created here, written by Handoff 54 §1 (maintenance). Install writes no
-- rows (D1). basis is free for 54 to define; nullable until it does.
CREATE TABLE IF NOT EXISTS service_kit_links (
    service_id      VARCHAR(36) NOT NULL,
    service_kit_id  VARCHAR(36) NOT NULL,
    basis           VARCHAR(32) DEFAULT NULL,
    created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (service_id, service_kit_id),
    KEY idx_service_kit_links_kit (service_kit_id),
    CONSTRAINT fk_service_kit_links_service
        FOREIGN KEY (service_id) REFERENCES services (id)
        ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Match service_kit_links.service_kit_id to service_kits.id exactly (type, charset,
-- collation). A foreign key needs matching charset and collation, and
-- service_kits kept whatever catalog_items had when 069 renamed it.
SET @skl_kit_col_parent = (
    SELECT CONCAT(COLUMN_TYPE, ' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits' AND COLUMN_NAME = 'id'
);
SET @skl_kit_col_child = (
    SELECT CONCAT(COLUMN_TYPE, ' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kit_links' AND COLUMN_NAME = 'service_kit_id'
);
SET @skl_kit_col = IF(
    @skl_kit_col_parent <=> @skl_kit_col_child,
    'SELECT 1',
    CONCAT('ALTER TABLE service_kit_links MODIFY COLUMN service_kit_id ', @skl_kit_col_parent, ' NOT NULL')
);
PREPARE stmt_skl_kit_col FROM @skl_kit_col;
EXECUTE stmt_skl_kit_col;
DEALLOCATE PREPARE stmt_skl_kit_col;

SET @skl_kit_fk = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kit_links'
        AND CONSTRAINT_NAME = 'fk_service_kit_links_kit' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE service_kit_links ADD CONSTRAINT fk_service_kit_links_kit FOREIGN KEY (service_kit_id) REFERENCES service_kits (id) ON DELETE CASCADE ON UPDATE RESTRICT'
);
PREPARE stmt_skl_kit_fk FROM @skl_kit_fk;
EXECUTE stmt_skl_kit_fk;
DEALLOCATE PREPARE stmt_skl_kit_fk;

-- ── 4. section_services.service_id ──────────────────────────────────────────
-- Nullable. Existing rows keep service_kit_id and get NULL here. A line
-- added from the catalog (§4) sets service_id and leaves service_kit_id NULL.
SET @ss_add_service_id = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_services' AND COLUMN_NAME = 'service_id') > 0,
    'SELECT 1',
    'ALTER TABLE section_services ADD COLUMN service_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER service_kit_id'
);
PREPARE stmt_ss_add_service_id FROM @ss_add_service_id;
EXECUTE stmt_ss_add_service_id;
DEALLOCATE PREPARE stmt_ss_add_service_id;

SET @ss_idx_service_id = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_services' AND INDEX_NAME = 'idx_section_services_service') > 0,
    'SELECT 1',
    'ALTER TABLE section_services ADD INDEX idx_section_services_service (service_id)'
);
PREPARE stmt_ss_idx_service_id FROM @ss_idx_service_id;
EXECUTE stmt_ss_idx_service_id;
DEALLOCATE PREPARE stmt_ss_idx_service_id;

SET @ss_fk_service_id = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'section_services'
        AND CONSTRAINT_NAME = 'fk_section_services_service' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE section_services ADD CONSTRAINT fk_section_services_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE SET NULL ON UPDATE RESTRICT'
);
PREPARE stmt_ss_fk_service_id FROM @ss_fk_service_id;
EXECUTE stmt_ss_fk_service_id;
DEALLOCATE PREPARE stmt_ss_fk_service_id;

-- ── 5. estimate_sections.service_category_id (for §3) ───────────────────────
-- Nullable. estimate_sections.name keeps the category name (plus an optional
-- suffix), so the contract generator and proposal pages need no change.
SET @es_add_category_id = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimate_sections' AND COLUMN_NAME = 'service_category_id') > 0,
    'SELECT 1',
    'ALTER TABLE estimate_sections ADD COLUMN service_category_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER name'
);
PREPARE stmt_es_add_category_id FROM @es_add_category_id;
EXECUTE stmt_es_add_category_id;
DEALLOCATE PREPARE stmt_es_add_category_id;

SET @es_idx_category_id = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimate_sections' AND INDEX_NAME = 'idx_estimate_sections_category') > 0,
    'SELECT 1',
    'ALTER TABLE estimate_sections ADD INDEX idx_estimate_sections_category (service_category_id)'
);
PREPARE stmt_es_idx_category_id FROM @es_idx_category_id;
EXECUTE stmt_es_idx_category_id;
DEALLOCATE PREPARE stmt_es_idx_category_id;

SET @es_fk_category_id = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimate_sections'
        AND CONSTRAINT_NAME = 'fk_estimate_sections_category' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE estimate_sections ADD CONSTRAINT fk_estimate_sections_category FOREIGN KEY (service_category_id) REFERENCES service_categories (id) ON DELETE SET NULL ON UPDATE RESTRICT'
);
PREPARE stmt_es_fk_category_id FROM @es_fk_category_id;
EXECUTE stmt_es_fk_category_id;
DEALLOCATE PREPARE stmt_es_fk_category_id;

-- ── 6. FULLTEXT index on materials for §2 search ────────────────────────────
-- Index only. No column, row or other index on materials changes. The first
-- FULLTEXT index on an InnoDB table rebuilds it once (12.5k rows).
SET @m_fulltext = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'materials' AND INDEX_NAME = 'ft_materials_description_alt') > 0,
    'SELECT 1',
    'ALTER TABLE materials ADD FULLTEXT INDEX ft_materials_description_alt (description, alternate_name)'
);
PREPARE stmt_m_fulltext FROM @m_fulltext;
EXECUTE stmt_m_fulltext;
DEALLOCATE PREPARE stmt_m_fulltext;

-- ── 7. service_default_items (the D2 template) — LAST, detect_073 keys here ─
-- Structurally parallel to section_service_components so §4 is a straight
-- copy. unit_cost_cents NULL = resolve live from material_prices at copy
-- time, then snapshot onto the component. inventory_id FK is ON UPDATE
-- RESTRICT: inventory_id values are Aspire item codes, never renamed in
-- place (070).
CREATE TABLE IF NOT EXISTS service_default_items (
    id               VARCHAR(36)   NOT NULL,
    service_id       VARCHAR(36)   NOT NULL,
    kind             ENUM('labor','material','equipment','subcontractor','other') NOT NULL,
    label            VARCHAR(255)  NOT NULL,
    inventory_id     VARCHAR(64)   DEFAULT NULL,
    service_kit_id   VARCHAR(36)   DEFAULT NULL,
    qty              DECIMAL(12,4) NOT NULL DEFAULT 0,
    unit_cost_cents  BIGINT        DEFAULT NULL,
    hours            DECIMAL(10,4) DEFAULT NULL,
    sort_order       INT           NOT NULL DEFAULT 0,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_default_items_service (service_id, sort_order),
    KEY idx_default_items_material (inventory_id),
    KEY idx_default_items_service_kit (service_kit_id),
    CONSTRAINT chk_default_items_cost_nonnegative CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
    CONSTRAINT fk_default_items_service
        FOREIGN KEY (service_id) REFERENCES services (id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_default_items_material
        FOREIGN KEY (inventory_id) REFERENCES materials (inventory_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Match service_default_items.service_kit_id to service_kits.id exactly (type, charset,
-- collation). A foreign key needs matching charset and collation, and
-- service_kits kept whatever catalog_items had when 069 renamed it.
SET @sdi_kit_col_parent = (
    SELECT CONCAT(COLUMN_TYPE, ' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_kits' AND COLUMN_NAME = 'id'
);
SET @sdi_kit_col_child = (
    SELECT CONCAT(COLUMN_TYPE, ' CHARACTER SET ', CHARACTER_SET_NAME, ' COLLATE ', COLLATION_NAME)
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_default_items' AND COLUMN_NAME = 'service_kit_id'
);
SET @sdi_kit_col = IF(
    @sdi_kit_col_parent <=> @sdi_kit_col_child,
    'SELECT 1',
    CONCAT('ALTER TABLE service_default_items MODIFY COLUMN service_kit_id ', @sdi_kit_col_parent, ' NULL')
);
PREPARE stmt_sdi_kit_col FROM @sdi_kit_col;
EXECUTE stmt_sdi_kit_col;
DEALLOCATE PREPARE stmt_sdi_kit_col;

SET @sdi_kit_fk = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_default_items'
        AND CONSTRAINT_NAME = 'fk_default_items_service_kit' AND CONSTRAINT_TYPE = 'FOREIGN KEY') > 0,
    'SELECT 1',
    'ALTER TABLE service_default_items ADD CONSTRAINT fk_default_items_service_kit FOREIGN KEY (service_kit_id) REFERENCES service_kits (id) ON DELETE SET NULL ON UPDATE RESTRICT'
);
PREPARE stmt_sdi_kit_fk FROM @sdi_kit_fk;
EXECUTE stmt_sdi_kit_fk;
DEALLOCATE PREPARE stmt_sdi_kit_fk;
