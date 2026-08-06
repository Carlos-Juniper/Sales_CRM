-- ---------------------------------------------------------------------------
-- 003 — Drop leads.hoa_property_id (Handoff 15, final step).
--
-- ⚠️ Run ONLY after the verification query at the end of 002 returns 0
--    (every lead that had an hoa_property_id now has a property_id).
--
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/migrations/003_drop_leads_hoa_property_id.sql
--
-- Leads reference ONLY the canonical properties table from here on; the HOA
-- provenance lives at properties.source_type='hoa' / properties.source_id.
-- ---------------------------------------------------------------------------

ALTER TABLE `leads` DROP COLUMN `hoa_property_id`;
