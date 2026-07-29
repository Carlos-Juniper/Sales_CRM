-- ---------------------------------------------------------------------------
-- properties — app-owned property records (source of truth), pushed to Aspire.
--
-- Conventions match hoa_properties.sql / management_companies.sql:
--   * VARCHAR(36) UUID primary key, InnoDB / utf8mb4
--   * created_at / updated_at DATETIME with CURRENT_TIMESTAMP defaults
--
-- Aspire is downstream: `aspire_property_id` is a nullable EXTERNAL REFERENCE
-- (never a FK, never an app-level lookup key). The async push flips
-- `aspire_sync_status` pending → synced (+ id + timestamp) or → failed (+ error);
-- a background sweep re-pushes pending/failed rows. With ASPIRE_SYNC_ENABLED=false
-- rows simply stay `pending` with a null aspire_property_id and the app is fully
-- functional on the local id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `juniper`.`properties` (
    `id`                    VARCHAR(36)   NOT NULL,
    `name`                  VARCHAR(255)  NOT NULL,
    `address1`              VARCHAR(255)  NOT NULL DEFAULT '',
    `address2`              VARCHAR(255)  DEFAULT NULL,
    `city`                  VARCHAR(100)  NOT NULL DEFAULT '',
    `state`                 CHAR(2)       NOT NULL DEFAULT '',
    `zip`                   VARCHAR(20)   NOT NULL DEFAULT '',
    -- city-level branch key (e.g. "Orlando, FL"), resolved to an Aspire BranchID
    -- by the port at push time.
    `branch_city`           VARCHAR(100)  DEFAULT NULL,
    `customer_type`         VARCHAR(30)   DEFAULT NULL,
    `management_company_id` VARCHAR(36)   DEFAULT NULL,
    -- Aspire external reference + async-sync bookkeeping
    `aspire_property_id`    INT           DEFAULT NULL,
    `aspire_sync_status`    ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
    `aspire_sync_error`     TEXT          DEFAULT NULL,
    `aspire_synced_at`      DATETIME      DEFAULT NULL,
    `created_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_prop_name`          (`name`),
    INDEX `idx_prop_sync_status`   (`aspire_sync_status`),
    INDEX `idx_prop_mgmt_co_id`    (`management_company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
