-- ---------------------------------------------------------------------------
-- Migration 015 — user-scoped "Leads" tab.
--
-- leads.created_by — logical ref (no FK, matching assigned_to/property_id
-- convention) to the users.id who manually created this lead. NULL for every
-- scraped lead, since the gov-bids pipeline ingests with no acting user.
--
-- Together with the existing assigned_to, this backs the per-rep Leads tab:
-- GET /api/leads?mine=true filters on (assigned_to = me OR created_by = me),
-- with the id taken from the JWT, never from a client-supplied param.
--
-- The three indexes support that filter plus the Public Leads feed, which now
-- narrows to the scraper sources (source IN ('higher_gov','sam_gov')).
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- Apply to local `crm` (no schema prefix); for the `juniper` schema, prefix
-- the table name (see the commented block at the bottom).
-- ---------------------------------------------------------------------------

ALTER TABLE leads
    ADD COLUMN created_by VARCHAR(36) NULL AFTER assigned_to,
    ADD INDEX idx_leads_created_by (created_by),
    ADD INDEX idx_leads_assigned_to (assigned_to),
    ADD INDEX idx_leads_source (source);

-- juniper-schema variant:
--   ALTER TABLE juniper.leads
--       ADD COLUMN created_by VARCHAR(36) NULL AFTER assigned_to,
--       ADD INDEX idx_leads_created_by (created_by),
--       ADD INDEX idx_leads_assigned_to (assigned_to),
--       ADD INDEX idx_leads_source (source);
