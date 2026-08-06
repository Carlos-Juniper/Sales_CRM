-- ---------------------------------------------------------------------------
-- Migration 005 — Handoff 24 (Intake Modal Completions).
--
-- 1. estimates.rfi_status — install RFI status tracked as a first-class field
--    (capture/display only; nothing gates approval on it).
-- 2. intake_submissions drafts — "Save draft" persists a partial intake with
--    is_draft=1 and NO estimate (estimate_id becomes NULLABLE). Drafts are
--    per-user (submitted_by) and device-independent.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- Apply to local `crm` (no schema prefix); for the `juniper` schema, prefix
-- the table names (see the commented block at the bottom).
-- ---------------------------------------------------------------------------

ALTER TABLE estimates
    ADD COLUMN rfi_status VARCHAR(255) DEFAULT NULL;

ALTER TABLE intake_submissions
    MODIFY COLUMN estimate_id VARCHAR(36) NULL,
    ADD COLUMN is_draft TINYINT(1) NOT NULL DEFAULT 0,
    ADD INDEX idx_intake_drafts (submitted_by, is_draft);
