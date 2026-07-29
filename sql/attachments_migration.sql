-- ---------------------------------------------------------------------------
-- Attachment storage upgrade — one-time migration for EXISTING databases.
--
-- Fresh installs get these columns from the updated CREATE statements in
-- estimating.sql / estimating_crm.sql.  Run THIS file once against a database
-- that was created before the GCS attachment feature landed.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.  If a
-- column already exists the statement errors harmlessly — skip it and continue.
-- Legacy rows end up with object_key=NULL → downloadable=false (by design).
--
-- LOCAL crm database (no schema prefix):
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/attachments_migration.sql
-- For the `juniper` schema, prefix each table name with `juniper.` (see bottom).
-- ---------------------------------------------------------------------------

ALTER TABLE intake_attachments
    MODIFY COLUMN url TEXT NULL,
    ADD COLUMN kind        ENUM('property_map','rfp','other') NOT NULL DEFAULT 'other',
    ADD COLUMN uploaded_by VARCHAR(36)  NULL,
    ADD COLUMN status      ENUM('pending','stored','failed')  NOT NULL DEFAULT 'pending',
    ADD COLUMN object_key  VARCHAR(512) NULL,
    ADD INDEX  idx_attachments_status (status);

-- ---------------------------------------------------------------------------
-- juniper-schema equivalents (uncomment / prefix when applying to `juniper`):
--   ALTER TABLE juniper.intake_attachments
--       MODIFY COLUMN url TEXT NULL,
--       ADD COLUMN kind        ENUM('property_map','rfp','other') NOT NULL DEFAULT 'other',
--       ADD COLUMN uploaded_by VARCHAR(36)  NULL,
--       ADD COLUMN status      ENUM('pending','stored','failed')  NOT NULL DEFAULT 'pending',
--       ADD COLUMN object_key  VARCHAR(512) NULL,
--       ADD INDEX  idx_attachments_status (status);
-- ---------------------------------------------------------------------------
