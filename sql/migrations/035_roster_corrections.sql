-- ---------------------------------------------------------------------------
-- Migration 035 — Roster corrections: Rod Leon rename, Michelle Cady title,
--   deactivate empty-name placeholder rows.
--
-- NOTE for Carlos: Michelle Cady appears both as a Juniper team_member (sales staff)
-- AND as a client_references referring contact for Coral Bay HOA (cr-001).
-- Likely the Coral Bay property manager contact is a different person.
-- With only 2 active client references, dropping cr-001 is significant — confirm before removing.
--
-- Background
-- ----------
-- Migration 015 seeded `team_members` with the following problems that remain
-- after migrations 029 and 030:
--
--   1. tm-rd-west-001: name='Rod Leon' (should be 'Rodrigo Leon') and
--      title='regional_director' (real title is 'sales_rep').
--
--   2. tm-rd-east-001: Michelle Cady's title='regional_director' is incorrect;
--      her real title is 'lead_sales_rep'.
--
--   3. tm-am-ftm-001: 'CRM Rep Placeholder' — migration 029 cleared the name
--      to '' but left active=1. This row must be deactivated (active=0) because
--      api/proposal_validation.py's _PLACEHOLDER_RE blocks any render that
--      includes a team member whose name contains "Placeholder". While 029
--      cleared the literal name, the row represents an unresolved placeholder
--      slot and should not appear on client-facing proposals until a real person
--      is linked via the Settings admin UI.
--
--   4. tm-pm-ftm-001: 'Fort Myers Production Manager' — same treatment as
--      tm-am-ftm-001 above. Deactivate until a real name is assigned.
--
-- Idempotency
-- -----------
-- All statements are UPDATE … WHERE with guards on both `id` and the current
-- value being corrected, so re-running this migration is always a safe no-op
-- once the correction has been applied.
--
-- Detection
-- ---------
-- detect_035 in scripts/migrate.py keys on name='Rodrigo Leon' being present
-- (the unambiguous output of statement §1 below).
-- ---------------------------------------------------------------------------


-- ── §1  Rod Leon → Rodrigo Leon; title 'regional_director' → 'sales_rep' ───
--   Guard: id matches AND name is still the old value.
--   aspire_branch_id and location are left as-is (NULL / Southwest Florida —
--   correct per the regional-director row seeded by 015).

UPDATE `team_members`
   SET name  = 'Rodrigo Leon',
       title = 'sales_rep'
 WHERE id   = 'tm-rd-west-001'
   AND name = 'Rod Leon';


-- ── §2  Michelle Cady: title 'regional_director' → 'lead_sales_rep' ─────────
--   Name is already 'Michelle Cady' (set by 015, preserved by 029/030).
--   Only the title needs correction.
--   Guard: id matches AND title is still the old value.

UPDATE `team_members`
   SET title = 'lead_sales_rep'
 WHERE id    = 'tm-rd-east-001'
   AND title = 'regional_director';


-- ── §3  Deactivate tm-am-ftm-001 (was 'CRM Rep Placeholder') ────────────────
--   Migration 029 cleared the name to ''; the row is still active=1.
--   Set active=0 so it is excluded from proposal rosters until Settings links
--   a real user. Guard: id matches AND active is still 1.

UPDATE `team_members`
   SET active = 0
 WHERE id     = 'tm-am-ftm-001'
   AND active = 1;


-- ── §4  Deactivate tm-pm-ftm-001 (was 'Fort Myers Production Manager') ───────
--   Migration 029 cleared the name to ''; the row is still active=1.
--   Set active=0 so it is excluded from proposal rosters until Settings links
--   a real person. Guard: id matches AND active is still 1.

UPDATE `team_members`
   SET active = 0
 WHERE id     = 'tm-pm-ftm-001'
   AND active = 1;
