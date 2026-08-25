-- ---------------------------------------------------------------------------
-- Migration 011 — Pipeline kanban redesign (Qualifying/Estimating/OP Review/
-- Approved).
--
-- leads.status is a plain VARCHAR(30) (no ENUM/CHECK to alter) — this is a
-- data-only rename: 'handed_off' -> 'estimating' (same concept, clearer
-- name; the lead status is now literally the kanban stage name). Run this
-- BEFORE deploying the renamed frontend/backend code, or existing
-- handed-off leads will silently vanish from the kanban (no column would
-- match the old string).
--
-- 'op_review' and 'approved' are brand-new string values with no prior rows
-- to backfill — no migration needed for those.
-- ---------------------------------------------------------------------------

UPDATE leads SET status = 'estimating' WHERE status = 'handed_off';

-- Verification — expect 0 rows still on the old value:
--   SELECT COUNT(*) FROM leads WHERE status = 'handed_off';
