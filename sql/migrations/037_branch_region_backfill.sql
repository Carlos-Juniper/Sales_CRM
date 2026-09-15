-- ---------------------------------------------------------------------------
-- Migration 037 — Backfill missing branches.region_id for Florida offices.
--
-- Background
-- ----------
-- Migration 015 seeded region_id ('east-coast' | 'west-coast' | 'central') on
-- only a "representative set" of branches; no migration since has backfilled
-- the rest. api/proposals.py's get_proposal_branch_coverage() buckets any FL
-- branch with region_id IS NULL into an "ungrouped" region (sort key
-- _UNGROUPED_REGION_SORT = 10_000), which the proposal's "Your Local
-- Landscape Experts" page renders as a 4th "Florida Locations" table — a page
-- the Coral Bay HOA reference document renders with exactly 3 region tables
-- (East Coast, Central, West Coast). This leaves 15 FL branches (of 40 total
-- NULL rows; the other 25 are holding/training/DO-NOT-USE rows or already
-- correctly bucketed by out-of-FL state) stuck in that phantom 4th table.
--
-- One of the 15 also has a live, user-visible side effect beyond just
-- appearing in the wrong table: get_proposal_branch_coverage groups branches
-- by street address via `by_address.setdefault(key, (state, region_of(r), ...))`
-- ordered by `branch_name`. At the West Orlando address, 'West Orlando
-- Aquatics' (region_id NULL) sorts before 'West Orlando Install' and
-- 'West Orlando Maintenance' (both already region_id='central'), so its NULL
-- region wins the setdefault race and the whole address group — including
-- the two already-correct rows — renders as ungrouped. Fixing 3704 below
-- restores 'central' for the entire West Orlando address group.
--
-- Assignments are by city, matched against the Coral Bay HOA reference's
-- region rosters. Two branches (Tyndall Install/Maintenance, Aquatics
-- Central Florida) don't appear in the reference at all; assigned
-- geographically per Carlos (Tyndall → west-coast, co-located with Panama
-- City Beach Maintenance; Aquatics Central Florida → central, St. Cloud is
-- in the Central FL corridor).
--
-- Idempotency
-- -----------
-- Every statement is UPDATE … WHERE aspire_branch_id = … AND region_id IS
-- NULL, so re-running is always a safe no-op once applied — and a branch
-- corrected by hand in the meantime is never clobbered.
--
-- Detection
-- ---------
-- detect_037 in scripts/migrate.py keys on aspire_branch_id 3704 (West
-- Orlando Aquatics) having region_id = 'central' — the fix with the widest
-- blast radius (it un-poisons the whole West Orlando address group) and the
-- last statement below, so a True there implies the earlier ones ran too.
-- ---------------------------------------------------------------------------


-- ── West Coast ───────────────────────────────────────────────────────────────

UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 1374 AND region_id IS NULL; -- Bradenton Install
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3684 AND region_id IS NULL; -- Bradenton Maintenance
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3691 AND region_id IS NULL; -- Tampa East Maintenance
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3698 AND region_id IS NULL; -- Venice Maintenance
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 1402 AND region_id IS NULL; -- Venice Install
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3682 AND region_id IS NULL; -- Panama City Beach Maintenance
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3685 AND region_id IS NULL; -- Tyndall Maintenance (geographic assignment; not in reference doc)
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3681 AND region_id IS NULL; -- Tyndall Install (geographic assignment; not in reference doc)
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3677 AND region_id IS NULL; -- Tampa North Install
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3695 AND region_id IS NULL; -- Tampa North Maintenance
UPDATE `branches` SET region_id = 'west-coast' WHERE aspire_branch_id = 3663 AND region_id IS NULL; -- Tampa South Maintenance


-- ── East Coast ───────────────────────────────────────────────────────────────

UPDATE `branches` SET region_id = 'east-coast' WHERE aspire_branch_id = 3705 AND region_id IS NULL; -- Daytona Maintenance
UPDATE `branches` SET region_id = 'east-coast' WHERE aspire_branch_id = 3673 AND region_id IS NULL; -- Riviera Beach Sports Turf (proactive fix; currently masked by the Davie address merge)


-- ── Central ──────────────────────────────────────────────────────────────────
-- 3704 un-poisons the whole West Orlando address group (see Background above)
-- and is this migration's detector row — keep it last.

UPDATE `branches` SET region_id = 'central' WHERE aspire_branch_id = 3702 AND region_id IS NULL; -- Aquatics Central Florida (geographic assignment; not in reference doc)
UPDATE `branches` SET region_id = 'central' WHERE aspire_branch_id = 3704 AND region_id IS NULL; -- West Orlando Aquatics
