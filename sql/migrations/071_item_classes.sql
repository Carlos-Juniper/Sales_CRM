-- ---------------------------------------------------------------------------
-- Migration 071 — Acumatica item classes.
--
-- The item class list is the one Acumatica uses to group catalog items
-- (scripts/data/acumatica_item_classes.xlsx, "Final List for Upload to
-- Acumatica"). scripts/load_item_classes.py parses it and upserts these
-- two tables. This file creates them empty.
--
-- item_class_groups: the ten top-level groups (100 Agronomy-Aquatics,
-- 600 Irrigation/Drainage, 700 Landscapes, 800 Live Goods, ...).
-- item_classes: one row per class. item_class_id is the Acumatica item
-- class id in its underscore form (IRRIGATION-PARTS_____), the same value
-- materials.item_class holds (070). There is no foreign key from
-- materials.item_class: materials rows already loaded can carry a class
-- this list does not have, and the loader reports them instead.
--
-- Additive and re-runnable (CREATE TABLE IF NOT EXISTS only). Detector:
-- scripts/migrate.py detect_071. Rollback (not applied by the runner):
-- sql/rollbacks/071_item_classes_down.sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS item_class_groups (
    code        SMALLINT UNSIGNED NOT NULL,
    name        VARCHAR(128)      NOT NULL,
    created_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS item_classes (
    item_class_id  VARCHAR(128)      NOT NULL,
    code           SMALLINT UNSIGNED NOT NULL,
    name           VARCHAR(128)      NOT NULL,
    group_code     SMALLINT UNSIGNED NOT NULL,
    posting_class  VARCHAR(64)       DEFAULT NULL,
    created_at     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (item_class_id),
    UNIQUE KEY uq_item_classes_code (code),
    KEY idx_item_classes_group (group_code),
    CONSTRAINT chk_item_classes_id CHECK (item_class_id <> ''),
    CONSTRAINT fk_item_classes_group
        FOREIGN KEY (group_code) REFERENCES item_class_groups (code)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
