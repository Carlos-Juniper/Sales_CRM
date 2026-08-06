-- ---------------------------------------------------------------------------
-- 001 — Canonical properties model (Handoff 15, Phase 1 schema).
--
-- Apply BY HAND to the live `crm` database (db.run_migrations() is a no-op):
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/migrations/001_canonical_properties.sql
--
-- NO `juniper.` prefix anywhere — the live DB is `crm`; the prefixed legacy
-- DDL in sql/ was never applied there (the missing-`properties`-table bug).
--
-- 1. Creates the canonical `properties` table: shared identity + Aspire sync
--    + a provenance pointer (source_type, source_id) back to the vertical
--    prospecting table the row was promoted from. Vertical-specific attributes
--    and prospecting workflow columns STAY on the vertical tables.
-- 2. Adds `leads.property_id` (canonical ref; hoa_property_id is dropped in 003
--    after the 002 backfill verifies).
-- 3. Reconciles `hoa_properties` drift: assigned_to / contact_status /
--    last_contacted are read+written by the app but were only ever added via an
--    out-of-tree migration.
--
-- No FK constraints — relationships are logical/indexed (repo convention).
-- ---------------------------------------------------------------------------

-- 1 ── canonical properties ---------------------------------------------------
CREATE TABLE IF NOT EXISTS `properties` (
    `id`                    VARCHAR(36)   NOT NULL,
    -- business category driving estimating/Aspire logic: hoa, hospital,
    -- cemetery, park, gov, manual, … VARCHAR (not ENUM) so new verticals never
    -- require an ALTER TABLE.
    `property_type`         VARCHAR(32)   NOT NULL,
    -- provenance: which vertical table the row was promoted from ('manual'
    -- when hand-entered). Usually equals property_type but legitimately
    -- diverges (manually-entered HOA ⇒ property_type='hoa', source_type='manual').
    `source_type`           VARCHAR(32)   NOT NULL,
    -- row id in that vertical table; NULL when source_type='manual'
    `source_id`             VARCHAR(36)   DEFAULT NULL,
    `name`                  VARCHAR(255)  NOT NULL,
    `address1`              VARCHAR(255)  NOT NULL DEFAULT '',
    `address2`              VARCHAR(255)  DEFAULT NULL,
    `city`                  VARCHAR(100)  NOT NULL DEFAULT '',
    `state`                 CHAR(2)       NOT NULL DEFAULT '',
    `zip`                   VARCHAR(20)   NOT NULL DEFAULT '',
    -- city-level branch key (e.g. "Orlando, FL"), resolved to an Aspire
    -- BranchID by the port at push time.
    `branch_city`           VARCHAR(100)  DEFAULT NULL,
    `customer_type`         VARCHAR(50)   DEFAULT NULL,
    `management_company_id` VARCHAR(36)   DEFAULT NULL,          -- → management_companies.id (logical)
    -- Aspire external reference + async-sync bookkeeping. 'unsynced' is the
    -- default: a property is LOCAL-ONLY until an estimate submission triggers
    -- the push ('pending' = queued/in-flight, set at trigger time).
    `aspire_property_id`    INT           DEFAULT NULL,
    `aspire_sync_status`    ENUM('unsynced','pending','synced','failed') NOT NULL DEFAULT 'unsynced',
    `aspire_sync_error`     TEXT          DEFAULT NULL,
    `aspire_synced_at`      DATETIME      DEFAULT NULL,
    `created_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    -- THE LINCHPIN: one vertical row promotes to exactly one property, making
    -- promotion an idempotent upsert. MySQL treats multiple NULLs as distinct,
    -- so (source_type='manual', source_id=NULL) rows are not blocked.
    UNIQUE KEY `uq_prop_source`        (`source_type`, `source_id`),
    INDEX `idx_prop_property_type`     (`property_type`),
    INDEX `idx_prop_name`              (`name`),
    INDEX `idx_prop_sync_status`       (`aspire_sync_status`),
    INDEX `idx_prop_mgmt_co_id`        (`management_company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2 ── leads.property_id (canonical ref; nullable — manual leads may have none)
ALTER TABLE `leads`
    ADD COLUMN `property_id` VARCHAR(36) DEFAULT NULL AFTER `raw_data`,
    ADD INDEX `idx_property_id` (`property_id`);

-- 3 ── hoa_properties drift reconciliation (columns the app already uses) -----
ALTER TABLE `hoa_properties`
    ADD COLUMN `assigned_to`    VARCHAR(255) DEFAULT NULL AFTER `branch_id`,
    ADD COLUMN `contact_status` VARCHAR(50)  DEFAULT NULL AFTER `assigned_to`,
    ADD COLUMN `last_contacted` DATE         DEFAULT NULL AFTER `contact_status`;
