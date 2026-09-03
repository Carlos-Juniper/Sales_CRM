-- ---------------------------------------------------------------------------
-- Migration 022 — contract: drop legacy branch city columns (Handoff 38, Slice 14).
--
-- This is the CONTRACT step of the expand/contract pair. Migration 019 added the
-- replacement aspire_branch_id columns (expand); this migration removes the now-
-- redundant city-string columns once every reader has been cut over (Slice 14).
--
-- APPLY ORDER — Carlos must run this manually after:
--   1. Back up the estimates and catalog_items tables.
--   2. Confirm Slice 14 code is deployed (readers no longer reference these columns).
--   3. Apply this migration: python -m scripts.migrate
--   4. Remove the residual branch-write TODOs in api/estimating.py:
--      - create_estimate: the `branch_city` param in the estimates INSERT
--      - _create_itb_project: the `body.get("branchCity") or body.get("branch", "")` line
--
-- DEFERRED: users.branch_id is NOT dropped here — that column is the only real
-- branch-assignment data until user_branches is backfilled. Its drop is a
-- SEPARATE later migration, blocked on completing the user_branches backfill
-- (Handoff 38 Amendment B.3).
--
-- Data safety: estimates.branch and catalog_items.branch hold MOCK data only
-- (§B.3). ~3/14 estimates have a real aspire_branch_id backfilled; the rest
-- are fabricated 'Phoenix-Desert' rows. Losing their city label is losing mock
-- data — acceptable.
--
-- Applied by scripts/migrate.py (detect_022 keys on estimates.branch absent).
-- ---------------------------------------------------------------------------

-- ── 1. estimates.branch ─────────────────────────────────────────────────────
-- Drop the index first (MySQL requires index removal before the column it covers).
ALTER TABLE estimates DROP INDEX idx_estimates_branch;
ALTER TABLE estimates DROP COLUMN branch;

-- ── 2. catalog_items.branch ─────────────────────────────────────────────────
ALTER TABLE catalog_items DROP INDEX idx_catalog_branch;
ALTER TABLE catalog_items DROP COLUMN branch;
