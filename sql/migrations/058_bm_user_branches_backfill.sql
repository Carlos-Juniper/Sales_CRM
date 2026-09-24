-- Backfill user_branches rows so branch managers on split-city branches
-- appear in the proposal "Meet Our Team" picker for BOTH twin branch ids.
--
-- Root cause: migration 057 pinned each manager's team_members row to a single
-- aspire_branch_id (the Install twin for split cities such as Fort Myers 1403).
-- The proposal config endpoint filters by aspire_branch_id, so a rep whose lead
-- carries the Maintenance twin (e.g. 3696) could not see that city's manager.
--
-- Resolution: branch scope is resolved through user_branches (the canonical
-- service-area table, migration 019). Adding both twin ids here means the
-- user_branches subquery in get_proposal_team_members (Amendment A.6, migration
-- 058 arm) surfaces the manager for whichever twin the lead sits on, without
-- duplicating the team_members roster row.
--
-- INSERT IGNORE: safe to re-run; duplicate (user_id, aspire_branch_id) silently
-- skips (PK is (user_id, aspire_branch_id)). Rows whose user_id or
-- aspire_branch_id is absent on a given DB instance are skipped by the JOIN —
-- no FK errors. Same idempotency contract as migration 057 (no _DETECT entry).
--
-- Branch twin ids verified against ASPIRE_BRANCH_MAP in api/aspire_config.py:
--   Fort Myers       Install=1403  Maintenance=3696
--   Bradenton        Install=1374  Maintenance=3684
--   Venice           Install=1402  Maintenance=3698
--   Tampa North      Install=3677  Maintenance=3695
--   Tampa East       Maintenance=3691  (Rinard scoped to 3691 ONLY here, matching
--                    live user_branches; 3677 Install stays Gerich's / Tampa North)
--   Naples           3697  (single — no twin, row still safe to INSERT IGNORE)
--   Tampa South      3663  (single)
--   Bonita Springs   1412  (single)
--   Estero           3671  (single)
--
-- Single-twin managers are included so this file is the complete user_branches
-- picture for all 11 managers; INSERT IGNORE makes the extra rows harmless.

INSERT IGNORE INTO user_branches (user_id, aspire_branch_id)
SELECT s.user_id, b.aspire_branch_id
  FROM (
    -- Alberto Toucet — Fort Myers (Install 1403, Maintenance 3696)
    SELECT '398230da-4334-4963-880c-a34ba16d5cbc' AS user_id, 1403 AS aspire_branch_id
    UNION ALL SELECT '398230da-4334-4963-880c-a34ba16d5cbc', 3696
    -- Brennen Garrett — Fort Myers
    UNION ALL SELECT '76692f5d-98d4-4b2c-9085-4a88b8b90ed0', 1403
    UNION ALL SELECT '76692f5d-98d4-4b2c-9085-4a88b8b90ed0', 3696
    -- Diego Cantu — Bradenton (Install 1374, Maintenance 3684)
    UNION ALL SELECT '5924d85f-4d3c-40ef-be08-c9c89f887b3c', 1374
    UNION ALL SELECT '5924d85f-4d3c-40ef-be08-c9c89f887b3c', 3684
    -- Todd Ruggles — Bradenton
    UNION ALL SELECT 'e8ebb236-0f8a-4223-85c3-07250109b4c3', 1374
    UNION ALL SELECT 'e8ebb236-0f8a-4223-85c3-07250109b4c3', 3684
    -- Eddie Tanguay — Venice (Install 1402, Maintenance 3698)
    UNION ALL SELECT '58c9ac90-cbac-4cff-8ccc-98d7cd2ddaa0', 1402
    UNION ALL SELECT '58c9ac90-cbac-4cff-8ccc-98d7cd2ddaa0', 3698
    -- Matthew Gerich — Tampa North (Install 3677, Maintenance 3695)
    UNION ALL SELECT '2bc19d99-7785-4ab4-9b13-10ff10f6fb25', 3677
    UNION ALL SELECT '2bc19d99-7785-4ab4-9b13-10ff10f6fb25', 3695
    -- Garth Rinard — Tampa East (3691 ONLY, matching live user_branches).
    -- 3677 is Tampa North's Install twin (Gerich's) and is deliberately NOT
    -- assigned to Rinard here — see header note.
    UNION ALL SELECT '768a600b-e92a-4055-bee0-06b8944b864b', 3691
    -- Catarino Martinez — Naples (single: 3697)
    UNION ALL SELECT '3c2bf1b9-e955-41dc-8e29-b2735aa58f5f', 3697
    -- Juan Nova — Tampa South (single: 3663)
    UNION ALL SELECT '1a1a09ae-3cfa-464f-a9d0-6a66861e5ef7', 3663
    -- Matt Hammond — Bonita Springs (single: 1412)
    UNION ALL SELECT 'f85ff28d-e266-47d4-b4a5-9aabbe59f845', 1412
    -- Roger Kelley — Estero (single: 3671)
    UNION ALL SELECT '8fa625b7-5e66-48e6-81f9-66acc4da4e06', 3671
  ) AS s
  JOIN branches b ON b.aspire_branch_id = s.aspire_branch_id
  JOIN users    u ON u.id = s.user_id;
