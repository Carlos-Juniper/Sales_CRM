-- ---------------------------------------------------------------------------
-- Migration 067 — legacy sales roles become maintenance sales
--
-- Numbered 067. The open commissions PR uses 065 and 066, so this file
-- does not take either number.
--
-- This file does not identify a person and does not grant vp_sales.
-- scripts/migrate.py apply_067 is the only place that can grant vp_sales,
-- and only when exactly one legacy-sales user has the exact first and last
-- name Michelle Cady. Zero matches or several matches grant vp_sales to
-- nobody and the runner logs an error. No email match is used: the repo
-- does not record a users login email for her.
--
-- After that grant (or the refusal), this statement moves every remaining
-- sales / outside_sales row to maintenance_sales. Rows on any other role
-- are not updated. Re-running the statement is a no-op once those roles
-- are gone. The runner records the migration as applied in
-- schema_migrations; it does not infer "applied" from the current roles.
-- ---------------------------------------------------------------------------

UPDATE users
   SET role = 'maintenance_sales'
 WHERE role IN ('sales', 'outside_sales');
