-- ---------------------------------------------------------------------------
-- Attachment storage upgrade — one-time migration for EXISTING databases.
--
-- Fresh installs get these columns from the updated CREATE statement in
-- estimating.sql.  Run THIS file once against a database that was created
-- before the GCS attachment feature landed.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.  If a
-- column already exists the statement errors harmlessly — skip it and continue.
-- Legacy rows end up with object_key=NULL → downloadable=false (by design).
--
-- NOTE: the `kind` enum below is the ORIGINAL set; migration
-- sql/migrations/012_takeoff_scan_and_manual_metadata.sql later adds the
-- 'takeoff_scan' value (already present in estimating.sql's CREATE).
--
-- LOCAL crm database:
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/create_table/attachments_migration.sql
-- ---------------------------------------------------------------------------

ALTER TABLE crm.intake_attachments
    MODIFY COLUMN url TEXT NULL,
    ADD COLUMN kind        ENUM('property_map','rfp','other') NOT NULL DEFAULT 'other',
    ADD COLUMN uploaded_by VARCHAR(36)  NULL,
    ADD COLUMN status      ENUM('pending','stored','failed')  NOT NULL DEFAULT 'pending',
    ADD COLUMN object_key  VARCHAR(512) NULL,
    ADD INDEX  idx_attachments_status (status);
