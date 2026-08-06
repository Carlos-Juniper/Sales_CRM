-- ---------------------------------------------------------------------------
-- 002 — Backfill: preserve leads.hoa_property_id as canonical property links.
--
-- Apply BY HAND to `crm` AFTER 001:
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/migrations/002_backfill_leads_property_id.sql
--
-- For each DISTINCT hoa_property_id still referenced by any lead, create one
-- canonical `properties` row (property_type='hoa', source_type='hoa',
-- source_id=<hoa id>) copying identity fields from hoa_properties, then point
-- leads.property_id at it. Backfilled rows are 'unsynced' — lead-origin
-- prospects must NOT push to Aspire (only estimate submission triggers a push).
--
-- Idempotent: the UNIQUE (source_type, source_id) key + INSERT IGNORE make
-- re-runs safe. DO NOT drop leads.hoa_property_id here — that is 003, gated on
-- the verification query below returning 0.
--
-- ============================================================================
-- !! WARNING — VERIFY hoa_properties.branch_id IN LIVE `crm` BEFORE APPLYING !!
--
-- Step 2 copies h.branch_id into properties.branch_city. branch_city expects a
-- branch NAME ("Orlando, FL"-style) — it is what Aspire branch resolution
-- matches on (api/aspire_sync.py), and a mismatch fails SILENTLY (the property
-- just never resolves a branch on push). If live hoa_properties.branch_id
-- holds ids ('b1', 'b2', …) instead of names, either:
--   * resolve via the `branches` reference table (migration 004):
--       JOIN branches b ON b.id = h.branch_id  …  SELECT b.branch_city
--   * or select NULL for branch_city and backfill later.
-- Only use h.branch_id verbatim if it already holds branch names. Check with:
--   SELECT DISTINCT branch_id FROM hoa_properties;
-- ============================================================================
-- ---------------------------------------------------------------------------

-- Counts before (review these):
SELECT COUNT(*) AS leads_with_hoa_ref
  FROM leads
 WHERE hoa_property_id IS NOT NULL;

SELECT COUNT(DISTINCT l.hoa_property_id) AS distinct_hoa_refs
  FROM leads l
 WHERE l.hoa_property_id IS NOT NULL;

-- Step 2: promote every lead-referenced HOA row to a canonical property.
INSERT IGNORE INTO properties
    (id, property_type, source_type, source_id, name, address1, city, state,
     zip, branch_city, management_company_id, customer_type, aspire_sync_status)
SELECT
    UUID(),
    'hoa',
    'hoa',
    h.id,
    h.property_name,
    h.address,
    h.city,
    h.state,
    h.zip,
    -- !! VERIFY BEFORE APPLYING (see header warning): branch_city expects a
    -- branch NAME; if branch_id is id-like ('b1'), resolve via `branches`
    -- (migration 004) or use NULL here — id values silently break Aspire
    -- branch resolution in api/aspire_sync.py.
    h.branch_id,
    h.management_company_id,
    'hoa',
    'unsynced'
FROM hoa_properties h
WHERE h.id IN (SELECT DISTINCT hoa_property_id FROM leads WHERE hoa_property_id IS NOT NULL);

-- Step 3: repoint the leads at the canonical rows.
UPDATE leads l
JOIN properties p
  ON p.source_type = 'hoa'
 AND p.source_id  = l.hoa_property_id
SET l.property_id = p.id
WHERE l.hoa_property_id IS NOT NULL;

-- Step 4 — VERIFICATION (must return 0 before running 003).
-- Leads that carried an hoa_property_id but did not get a property_id
-- (i.e. the hoa_properties row no longer exists — resolve manually).
SELECT COUNT(*) AS unresolved_leads
  FROM leads
 WHERE hoa_property_id IS NOT NULL
   AND property_id IS NULL;
