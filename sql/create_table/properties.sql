-- ---------------------------------------------------------------------------
-- properties — CANONICAL app-owned property records (Handoff 15).
--
-- Single source of truth for every physical location the app engages, across
-- all verticals. Vertical prospecting tables (hoa_properties, hospitals, …)
-- feed into this table on engagement ("promote on engagement"): a row is
-- created only when a lead or estimate starts. Vertical-specific attributes
-- and prospecting workflow columns stay on the vertical tables; join back via
-- (source_type, source_id) when detail is needed.
--
-- ⚠️ The live database is `crm`, NOT `juniper` — apply via the unprefixed
-- migration sql/migrations/001_canonical_properties.sql (this juniper-prefixed
-- file exists to keep the legacy DDL set complete). db.run_migrations() is a
-- no-op; all migrations are hand-run (see sql/migrations/README.md).
--
-- Conventions match hoa_properties.sql / management_companies.sql:
--   * VARCHAR(36) UUID primary key, InnoDB / utf8mb4
--   * created_at / updated_at DATETIME with CURRENT_TIMESTAMP defaults
--   * NO FK constraints — relationships are logical/indexed
--
-- Aspire is downstream: `aspire_property_id` is a nullable EXTERNAL REFERENCE
-- (never a FK, never an app-level lookup key). A property is LOCAL-ONLY
-- ('unsynced') until an estimate submission triggers the push — the ONLY sync
-- trigger. The push flips 'pending' → 'synced' (+ id + timestamp) or →
-- 'failed' (+ error).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `juniper`.`properties` (
    `id`                    VARCHAR(36)   NOT NULL,
    -- business category (hoa, hospital, cemetery, park, gov, manual, …);
    -- VARCHAR not ENUM so new verticals never require an ALTER TABLE.
    `property_type`         VARCHAR(32)   NOT NULL,
    -- provenance table ('hoa', 'hospital', … or 'manual'); usually equals
    -- property_type but legitimately diverges (manually-entered HOA).
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
    `management_company_id` VARCHAR(36)   DEFAULT NULL,
    -- Aspire external reference + async-sync bookkeeping ('unsynced' default:
    -- local-only until estimate submission triggers the push)
    `aspire_property_id`    INT           DEFAULT NULL,
    `aspire_sync_status`    ENUM('unsynced','pending','synced','failed') NOT NULL DEFAULT 'unsynced',
    `aspire_sync_error`     TEXT          DEFAULT NULL,
    `aspire_synced_at`      DATETIME      DEFAULT NULL,
    `created_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    -- one vertical row promotes to exactly one property (idempotent upsert);
    -- NULL source_ids (manual rows) are not blocked — MySQL treats NULLs as distinct
    UNIQUE KEY `uq_prop_source`        (`source_type`, `source_id`),
    INDEX `idx_prop_property_type`     (`property_type`),
    INDEX `idx_prop_name`              (`name`),
    INDEX `idx_prop_sync_status`       (`aspire_sync_status`),
    INDEX `idx_prop_mgmt_co_id`        (`management_company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
