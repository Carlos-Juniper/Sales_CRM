-- Migration 027: link estimates to their latest generated proposal PDF
--
-- Today the only path from an estimate to its rendered proposal PDF is two
-- logical joins: estimates.id <- proposal_requests.estimate_id <-
-- proposal_renders.proposal_id -> object_key. This adds a denormalized
-- pointer to the latest successful render directly on estimates, so "does
-- this estimate have a proposal PDF, and where" is a flat lookup instead of
-- a join every time (e.g. for list views). proposal_renders remains the
-- source of truth for full version history.
--
-- No FK constraints — logical references only (repo convention, matches
-- proposal_requests.estimate_id / proposal_renders.proposal_id).

ALTER TABLE estimates
  ADD COLUMN latest_proposal_render_id VARCHAR(36) NULL
    COMMENT 'Logical ref -> proposal_renders.id for the most recent successful render',
  ADD COLUMN latest_proposal_object_key VARCHAR(512) NULL
    COMMENT 'GCS object key of the most recent successful proposal render';
