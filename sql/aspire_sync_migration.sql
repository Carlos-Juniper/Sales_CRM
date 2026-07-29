-- ---------------------------------------------------------------------------
-- Aspire integration — one-time migration for EXISTING databases.
--
-- Fresh installs get these columns from the updated CREATE statements in
-- estimating.sql / estimating_crm.sql, crm_users.sql, management_companies.sql
-- and the new properties.sql. Run THIS file once against a database that was
-- created before the Aspire integration to add the same columns in place.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once. If a
-- column already exists the statement errors harmlessly — skip it and continue.
--
-- LOCAL crm database (no schema prefix):
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/aspire_sync_migration.sql
-- For the `juniper` schema, prefix each table name with `juniper.` (see bottom).
-- ---------------------------------------------------------------------------

-- Also create the new app-owned properties table if it isn't present yet.
-- (Apply sql/properties.sql; for the crm schema strip its `juniper.` prefix.)

-- estimates: property link + Aspire opportunity reference + sync bookkeeping.
ALTER TABLE estimates
    ADD COLUMN property_id           VARCHAR(36) DEFAULT NULL,
    ADD COLUMN aspire_opportunity_id INT         DEFAULT NULL,
    ADD COLUMN aspire_lost_reason_id INT         DEFAULT NULL,
    ADD COLUMN aspire_sync_status    ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
    ADD COLUMN aspire_sync_error     TEXT        DEFAULT NULL,
    ADD COLUMN aspire_synced_at      DATETIME    DEFAULT NULL,
    ADD INDEX  idx_estimates_sync_status (aspire_sync_status),
    ADD INDEX  idx_estimates_property_id (property_id);

-- crm_users: Aspire ContactID for SalesRepContactID (NOT the Aspire UserID).
ALTER TABLE crm_users
    ADD COLUMN aspire_rep_id INT DEFAULT NULL;

-- management_companies: Aspire external reference + sync bookkeeping.
ALTER TABLE management_companies
    ADD COLUMN aspire_company_id  INT      DEFAULT NULL,
    ADD COLUMN aspire_sync_status ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
    ADD COLUMN aspire_sync_error  TEXT     DEFAULT NULL,
    ADD COLUMN aspire_synced_at   DATETIME DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- juniper-schema equivalents (uncomment / prefix when applying to `juniper`):
--   ALTER TABLE juniper.estimates ... ;
--   ALTER TABLE juniper.crm_users ADD COLUMN aspire_rep_id INT DEFAULT NULL;
--   ALTER TABLE juniper.management_companies ... ;
-- ---------------------------------------------------------------------------
