-- ---------------------------------------------------------------------------
-- Migration 006 — Handoff 21 (ITB Tracker Backend & Auto-Generation).
--
-- itb_projects.estimate_id — the 1:1 link from an ITB project to the estimate
-- that auto-generated it (LOCKED: one estimate → one itb_projects row, created
-- at intake from EITHER form). NULLable so any pre-existing manually-seeded
-- rows survive; every auto-generated row sets it. UNIQUE enforces the 1:1.
--
-- No FK constraint, matching the migration-set convention (relationships are
-- logical/indexed; integrity enforced in code).
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- Apply to local `crm` (no schema prefix); for the `juniper` schema, prefix
-- the table name (see the commented block at the bottom).
-- ---------------------------------------------------------------------------

ALTER TABLE itb_projects
    ADD COLUMN estimate_id VARCHAR(36) NULL AFTER id,
    ADD UNIQUE INDEX uq_itb_estimate (estimate_id);

-- juniper-schema variant:
--   ALTER TABLE juniper.itb_projects
--       ADD COLUMN estimate_id VARCHAR(36) NULL AFTER id,
--       ADD UNIQUE INDEX uq_itb_estimate (estimate_id);
