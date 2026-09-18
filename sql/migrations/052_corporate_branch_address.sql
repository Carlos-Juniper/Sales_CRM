-- Migration 052 — Set the Corporate branch's office address
--
-- The Corporate row in `branches` has no address1/city/state/zip, which is
-- why it dropped out of the old lat/lng-required proximity query entirely
-- (fixed in api/proposals.py's proposalId-scoped /config/branches — see
-- migration 051's sibling code change) and why a rep whose user_branches
-- includes Corporate saw it render with no address on the "Local Branches"
-- footer / any office-address lookup that needs one.
--
-- lat/lng are deliberately left untouched (NULL) — no coordinates were
-- provided, and the proposalId-scoped branch fetch already handles an
-- ungeocoded office correctly (sorts last, no distance crash). Geocode
-- separately if the map/proximity math should include Corporate.
--
-- ⚠️ branches rows are mirrored from Aspire exports (migration 004) and
-- address1/city/state/zip ARE included in that reseed's ON DUPLICATE KEY
-- UPDATE list (unlike lat/lng/region_id, which are guarded — Amendment A.2).
-- A future full Aspire reseed will overwrite this address unless Aspire's
-- own record is corrected to match.
--
-- Matched by branch_name (its aspire_branch_id isn't recorded anywhere in
-- this repo's migrations — verify this is the only 'Corporate' row before
-- applying).

UPDATE `branches`
   SET address1 = '4415 Metro Parkway, Suite 300',
       city     = 'Fort Myers',
       state    = 'FL',
       zip      = '33916'
 WHERE branch_name = 'Corporate';
