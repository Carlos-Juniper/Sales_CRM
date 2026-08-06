-- ---------------------------------------------------------------------------
-- sales_territories — the "City, ST" units scoping/intake/push operate on
-- (Handoff 18).
--
-- The vocabulary the app actually speaks: the intake dropdown, estimates.branch,
-- properties.branch_city, users.branch_id, and branch read-scoping
-- (api/authz.resolve_branch_name) all key off these ids. Each territory routes
-- to a maintenance + an install Aspire branch (logical refs into
-- branches.aspire_branch_id; no FK, per this set's convention). Territory→branch
-- is many-to-one and can cross cities, so it is NOT derivable from branch data.
--
-- The live database is `crm` (schema-qualified here as `crm.`). The applied
-- change history lives in sql/migrations/004_users_and_branches.sql; this
-- CREATE keeps the create_table DDL set complete (recreate-from-scratch source).
--
-- Seed block below sourced from ASPIRE_BRANCH_MAP (api/aspire_config.py, captured
-- 2026-07-27); maintenance == install for cities with no dedicated install
-- branch (install falls back to maintenance at push time). Idempotent.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `crm`.`sales_territories` (
    id     VARCHAR(100) NOT NULL,           -- "City, ST" (== users.branch_id, estimates.branch, properties.branch_city)
    name   VARCHAR(255) NOT NULL,           -- same "City, ST" value
    state  CHAR(2)      NULL DEFAULT NULL,
    region VARCHAR(255) NULL DEFAULT NULL,  -- Aspire RegionName is unpopulated; fill when defined
    -- Aspire BranchID this territory routes to per service line — logical refs
    -- into branches.aspire_branch_id (no FK, per this set's convention). Equal
    -- when the city has no dedicated install branch (install → maintenance).
    aspire_branch_id_maintenance INT NULL DEFAULT NULL,
    aspire_branch_id_install     INT NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_territories_name (name),
    INDEX idx_territories_maint   (aspire_branch_id_maintenance),
    INDEX idx_territories_install (aspire_branch_id_install)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sourced from ASPIRE_BRANCH_MAP (api/aspire_config.py — captured live
-- 2026-07-27), cross-validated against the branches export above: all 56
-- (territory, service-line) routings resolve to an ACTIVE branch, none to a
-- "DO NOT USE"/inactive row. maintenance == install for the 13 cities with no
-- dedicated install branch (install falls back to maintenance at push time).
INSERT INTO `crm`.`sales_territories` (id, name, state, aspire_branch_id_maintenance, aspire_branch_id_install) VALUES
    ('Bonita Springs, FL', 'Bonita Springs, FL', 'FL', 1412, 1412),
    ('Bradenton, FL', 'Bradenton, FL', 'FL', 3684, 1374),
    ('Fort Lauderdale, FL', 'Fort Lauderdale, FL', 'FL', 3636, 3636),
    ('Fort Myers, FL', 'Fort Myers, FL', 'FL', 3696, 1403),
    ('Melbourne, FL', 'Melbourne, FL', 'FL', 3676, 3676),
    ('Naples, FL', 'Naples, FL', 'FL', 3697, 3697),
    ('Ocala, FL', 'Ocala, FL', 'FL', 3694, 3674),
    ('Orlando, FL', 'Orlando, FL', 'FL', 3668, 3579),
    ('Palm Beach Gardens, FL', 'Palm Beach Gardens, FL', 'FL', 3683, 3683),
    ('Panama City Beach, FL', 'Panama City Beach, FL', 'FL', 3682, 3681),
    ('Riviera Beach, FL', 'Riviera Beach, FL', 'FL', 3672, 3672),
    ('Sarasota, FL', 'Sarasota, FL', 'FL', 3684, 1374),
    ('Tampa East, FL', 'Tampa East, FL', 'FL', 3691, 3677),
    ('Tampa North, FL', 'Tampa North, FL', 'FL', 3695, 3677),
    ('Tampa South, FL', 'Tampa South, FL', 'FL', 3663, 3663),
    ('Venice, FL', 'Venice, FL', 'FL', 3698, 1402),
    ('Vero Beach, FL', 'Vero Beach, FL', 'FL', 3577, 3577),
    ('Daytona, FL', 'Daytona, FL', 'FL', 3705, 3705),
    ('Estero, FL', 'Estero, FL', 'FL', 3671, 3671),
    ('South Orlando, FL', 'South Orlando, FL', 'FL', 3666, 3666),
    ('West Orlando, FL', 'West Orlando, FL', 'FL', 3699, 3579),
    ('Tyndall, FL', 'Tyndall, FL', 'FL', 3685, 3681),
    ('Houston, TX', 'Houston, TX', 'TX', 3679, 3680),
    ('Hilton Head, SC', 'Hilton Head, SC', 'SC', 3706, 3707),
    ('Lancaster, PA', 'Lancaster, PA', 'PA', 3686, 3686),
    ('Carlisle, PA', 'Carlisle, PA', 'PA', 3687, 3687),
    ('Raleigh, NC', 'Raleigh, NC', 'NC', 3688, 3689),
    ('Wilmington, NC', 'Wilmington, NC', 'NC', 3688, 3689)
ON DUPLICATE KEY UPDATE
    name = VALUES(name), state = VALUES(state),
    aspire_branch_id_maintenance = VALUES(aspire_branch_id_maintenance),
    aspire_branch_id_install     = VALUES(aspire_branch_id_install);
