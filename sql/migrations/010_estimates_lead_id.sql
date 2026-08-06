-- ---------------------------------------------------------------------------
-- Migration 010 — Pipeline kanban redesign (Qualifying/Estimating/OP Review/
-- Approved).
--
-- estimates.lead_id — logical ref (no FK, matching property_id/
-- aspire_opportunity_id convention) to the sales lead this estimate was
-- created against. Nullable — estimates created without a lead (e.g. direct
-- Aspire import) have none. Drives the lead→estimate status write-back in
-- api/estimating.py: creating an estimate with a leadId moves that lead from
-- Qualifying to Estimating; the estimate's status later reaching
-- review/pending_approval/approved write-backs the lead to OP Review/Approved.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- Apply to local `crm` (no schema prefix); for the `juniper` schema, prefix
-- the table name (see the commented block at the bottom).
-- ---------------------------------------------------------------------------

ALTER TABLE estimates
    ADD COLUMN lead_id VARCHAR(36) NULL AFTER property_id,
    ADD INDEX idx_estimates_lead_id (lead_id);

-- juniper-schema variant:
--   ALTER TABLE juniper.estimates
--       ADD COLUMN lead_id VARCHAR(36) NULL AFTER property_id,
--       ADD INDEX idx_estimates_lead_id (lead_id);
