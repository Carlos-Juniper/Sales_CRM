-- ---------------------------------------------------------------------------
-- Migration 067 — legacy sales roles become maintenance sales
--
-- Numbered 067. The open commissions PR uses 065 and 066, so this file
-- does not take either number.
--
-- Every users row whose role is 'sales' or 'outside_sales' becomes
-- 'maintenance_sales'. This file does not identify a person and does not
-- grant vp_sales. After deploy, an admin sets Michelle Cady to VP of Sales
-- in Settings, then Users.
--
-- Rows on any other role are not updated. Re-running is a no-op once no
-- sales or outside_sales rows remain. There is no schema signal, so the
-- runner does not guess "already applied" from the current roles; the
-- schema_migrations row recorded after this statement is what means applied.
-- ---------------------------------------------------------------------------

UPDATE users
   SET role = 'maintenance_sales'
 WHERE role IN ('sales', 'outside_sales');
