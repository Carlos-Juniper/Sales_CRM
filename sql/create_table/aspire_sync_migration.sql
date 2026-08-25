-- ---------------------------------------------------------------------------
-- Aspire integration — one-time migration for EXISTING databases.
--
-- Fresh installs get these columns from the updated CREATE statements in
-- estimating.sql, users.sql, management_companies.sql and properties.sql.
-- Run THIS file once against a database that was created before the Aspire
-- integration to add the same columns in place.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once. If a
-- column already exists the statement errors harmlessly — skip it and continue.
--
-- LOCAL crm database:
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/create_table/aspire_sync_migration.sql
-- ---------------------------------------------------------------------------

-- Also create the new app-owned properties table if it isn't present yet
-- (apply sql/create_table/properties.sql).

-- estimates: property link + Aspire opportunity reference + sync bookkeeping.
ALTER TABLE crm.estimates
    ADD COLUMN property_id           VARCHAR(36) DEFAULT NULL,
    ADD COLUMN aspire_opportunity_id INT         DEFAULT NULL,
    ADD COLUMN aspire_lost_reason_id INT         DEFAULT NULL,
    ADD COLUMN aspire_sync_status    ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
    ADD COLUMN aspire_sync_error     TEXT        DEFAULT NULL,
    ADD COLUMN aspire_synced_at      DATETIME    DEFAULT NULL,
    ADD INDEX  idx_estimates_sync_status (aspire_sync_status),
    ADD INDEX  idx_estimates_property_id (property_id);

-- users: Aspire ContactID for SalesRepContactID (NOT the Aspire UserID).
ALTER TABLE crm.users
    ADD COLUMN aspire_rep_id INT DEFAULT NULL;

-- management_companies: Aspire external reference + sync bookkeeping.
ALTER TABLE crm.management_companies
    ADD COLUMN aspire_company_id  INT      DEFAULT NULL,
    ADD COLUMN aspire_sync_status ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
    ADD COLUMN aspire_sync_error  TEXT     DEFAULT NULL,
    ADD COLUMN aspire_synced_at   DATETIME DEFAULT NULL;
