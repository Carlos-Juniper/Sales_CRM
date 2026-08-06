-- ---------------------------------------------------------------------------
-- Migration 012 — Handoff 27: Takeoff Insert persistence & manual metadata.
--
-- 1. intake_attachments gains:
--    * a 'takeoff_scan' value in the kind enum (the Takeoff Insert scanned
--      boundary map, persisted via the same GCS flow as intake docs);
--    * an estimate_id column — takeoff scans are ESTIMATE-scoped, not
--      intake-submission-scoped, so they link straight to the estimate;
--    * a NULLable intake_submission_id (takeoff scans have no submission).
--
-- 2. estimates gains manual takeoff metadata:
--    * turf_area_acres, curb_miles — estimator-entered today. Beam AI
--      automated takeoff is the eventual source (paused, Handoffs 14/14b):
--      when it lands it writes these SAME columns; no schema change needed.
--      Acreage & sqft stay derived from sections — never stored.
--
-- Hand-run. LOCAL crm database (no schema prefix):
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/migrations/012_takeoff_scan_and_manual_metadata.sql
-- For the `juniper` schema, prefix each table name with `juniper.`
-- (verify the enum/column state against the live crm DB first).
-- ---------------------------------------------------------------------------

-- Drop the FK first: MySQL will not MODIFY an FK child column in place.
ALTER TABLE intake_attachments
    DROP FOREIGN KEY fk_attachments_intake;

ALTER TABLE intake_attachments
    MODIFY COLUMN intake_submission_id VARCHAR(36) NULL,
    MODIFY COLUMN kind ENUM('property_map','rfp','other','takeoff_scan') NOT NULL DEFAULT 'other',
    ADD COLUMN estimate_id VARCHAR(36) NULL AFTER intake_submission_id,
    ADD CONSTRAINT fk_attachments_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id) ON DELETE CASCADE,
    ADD INDEX idx_attachments_estimate (estimate_id);

ALTER TABLE intake_attachments
    ADD CONSTRAINT fk_attachments_intake
        FOREIGN KEY (intake_submission_id) REFERENCES intake_submissions (id) ON DELETE CASCADE;

ALTER TABLE estimates
    ADD COLUMN turf_area_acres DECIMAL(10,2) NULL AFTER acreage,
    ADD COLUMN curb_miles      DECIMAL(10,2) NULL AFTER turf_area_acres;
