-- ---------------------------------------------------------------------------
-- Migration 019 — branch model (Handoff 38, Slice 1).
--
-- Replaces the branch *string* with the Aspire branch *id* on the two estimating
-- tables, and gives users a many-to-many branch assignment.
--
-- Why an id and not the city string: Aspire branch rows encode service line
-- (Fort Myers Install = 1403, Fort Myers Maintenance = 3696), which is the grain
-- crew rates and production rates actually vary at. "Fort Myers, FL" cannot tell
-- the two apart, so it cannot key branch_settings (the next Handoff 38 migration).
--
-- The column is `aspire_branch_id`, NOT `branch_id`: `branch_id` is already a
-- VARCHAR(100) territory string ("Fort Myers, FL") on leads, users,
-- hoa_properties and bids. Reusing the name for an INT would put two types
-- behind one name in adjacent tables.
--
-- leads.branch_id and hoa_properties.branch_id deliberately DO NOT change — a
-- prospect has no service line yet, so the territory is the only honest value.
-- users.branch_id is also left in place here and dropped by a later migration,
-- once nothing reads it (Handoff 38 Amendment B.3).
--
-- The number is 019, not 016: worktree-proposify numbers its own migrations from
-- 014 and claims through 018. See Handoff 38 Amendment D.
--
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- Applied by scripts/migrate.py (detect_019 keys on estimates.aspire_branch_id).
-- ---------------------------------------------------------------------------

-- ── 1. Branch picker flag ───────────────────────────────────────────────────
-- `regions` and branches.lat/lng/region_id are NOT created here — Handoff 40's
-- migration 014 already created them and is already applied to crm.
--
-- is_operating_branch is a LOCAL flag: 21 of the 56 Aspire rows are not real
-- offices, and only 9 of them say "DO NOT USE" — the rest are named things like
-- "Training Branch" and "*** PICK A BRANCH ***", which an active/name filter
-- cannot catch.
--
-- This column MUST be excluded from the Aspire reseed's UPDATE list, alongside
-- 014's lat/lng/region_id (see sql/create_table/branches.sql) — a reseed would
-- otherwise wipe it.
ALTER TABLE branches
    ADD COLUMN is_operating_branch TINYINT(1) NOT NULL DEFAULT 1,
    ADD INDEX idx_branches_operating (is_operating_branch);

UPDATE branches
   SET is_operating_branch = 0
 WHERE branch_name LIKE '%DO NOT USE%'
    OR branch_name IN (
        '*** PICK A BRANCH ***',
        'General Holding',
        'Contract and Billing',
        'Learning & Development',
        'Training Branch',
        'Training Branch EC',
        'Golden Palms on Orange River'
    );

-- ── 2. users.active ─────────────────────────────────────────────────────────
-- Deactivate, never delete: no FK points at users.id (assigned_ls_estimator,
-- crm_rep, itb_projects.sales_rep, estimate_status_transitions.actor are all
-- bare VARCHAR(36)), so a hard delete dangles every historical reference.
ALTER TABLE users
    ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1,
    ADD INDEX idx_users_active (active);

-- ── 3. user_branches ────────────────────────────────────────────────────────
-- Replaces the users.branch_id scalar for every role; N=1 is the ordinary case
-- (an estimator holds one row, an RD holds eight). One code path, and it is what
-- lets a Fort Myers manager hold BOTH 1403 (Install) and 3696 (Maintenance).
--
-- This set's convention is logical refs without FKs, and this table breaks it
-- deliberately: the whole argument for a join table over a JSON array was that a
-- stale branch id must not silently scope someone to nothing.
--
-- Seeded EMPTY on purpose. users.branch_id holds the placeholder 'c1' for 7 of 8
-- rows, which matches no sales_territories row, so there is nothing to backfill
-- from. Branch scoping is already vacuous for those users today; assignments are
-- made in Settings > Users (Slice 6).
CREATE TABLE IF NOT EXISTS user_branches (
    user_id          VARCHAR(36) NOT NULL,
    aspire_branch_id INT         NOT NULL,
    created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, aspire_branch_id),
    INDEX idx_user_branches_branch (aspire_branch_id),
    CONSTRAINT fk_user_branches_branch
        FOREIGN KEY (aspire_branch_id) REFERENCES branches (aspire_branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. estimates.branch → estimates.aspire_branch_id ────────────────────────
-- sales_territories already carries the territory→branch mapping per service
-- line, and sales_territories.id is the same "City, ST" value estimates.branch
-- holds, so the backfill is pure SQL — no ASPIRE_BRANCH_MAP lookup script.
--
-- Unmatched rows land NULL. On the 2026-09-01 snapshot that is 11 of 14 rows,
-- all of them the fabricated 'Phoenix-Desert' demo value, which is not a Juniper
-- territory. Acceptable only because every estimating row is mock data today;
-- re-check this count before applying to a database holding real estimates.
ALTER TABLE estimates
    ADD COLUMN aspire_branch_id INT NULL DEFAULT NULL AFTER branch,
    ADD INDEX idx_estimates_aspire_branch (aspire_branch_id);

UPDATE estimates e
  JOIN sales_territories t ON t.id = e.branch
   SET e.aspire_branch_id = CASE
        WHEN e.estimate_type = 'install' THEN t.aspire_branch_id_install
        ELSE t.aspire_branch_id_maintenance
   END;

-- `branch` is deliberately NOT dropped here — see the note at the end of §5.

-- ── 5. catalog_items.branch → catalog_items.aspire_branch_id ────────────────
-- catalog_items.branch holds Aspire *branch names*, not territories, and
-- 'All Branches' (119 of 128 rows) becomes NULL — the house convention from
-- Handoff 38 §2.3 is that NULL aspire_branch_id means company-wide.
ALTER TABLE catalog_items
    ADD COLUMN aspire_branch_id INT NULL DEFAULT NULL AFTER branch,
    ADD INDEX idx_catalog_aspire_branch (aspire_branch_id);

UPDATE catalog_items c
  JOIN branches b ON b.branch_name = c.branch
   SET c.aspire_branch_id = b.aspire_branch_id;

-- One row carries two branches in one text field
-- ('Houston Maintenance, Houston Install') and cannot become a single INT.
-- Split it: the original takes Houston Maintenance, a copy takes Houston Install.
UPDATE catalog_items
   SET aspire_branch_id = 3679                       -- Houston Maintenance
 WHERE branch = 'Houston Maintenance, Houston Install';

INSERT INTO catalog_items
    (id, description, uom, unit_cost_cents, unit_sell_cents, target_gm,
     kit_type, production_rate, branch, aspire_branch_id, active, service_type)
SELECT UUID(), description, uom, unit_cost_cents, unit_sell_cents, target_gm,
       kit_type, production_rate, branch, 3680,      -- Houston Install
       active, service_type
  FROM catalog_items
 WHERE branch = 'Houston Maintenance, Houston Install'
   AND aspire_branch_id = 3679;

-- ── Why neither `branch` column is dropped here ─────────────────────────────
-- This migration is EXPAND ONLY. Every reader in api/estimating.py still selects
-- and filters `branch` (_estimate_out, _catalog_item_out, _UPDATABLE,
-- list_estimates, create_estimate, list_catalog_items), so dropping it in the
-- same migration that adds the replacement takes the estimating API down until
-- the Slice 8 cutover lands.
--
-- An earlier revision of this file did drop both columns, on the reasoning that
-- estimating data is mock (Amendment B.3). That argument is about losing *data*
-- safely; it says nothing about code still referencing the column. Both drops
-- move to the contract migration in Slice 14, alongside users.branch_id.
