-- ---------------------------------------------------------------------------
-- Migration 015 — Handoff 37, Slice 3: MVP seed data for proposal config tables
--   (Amendment A — uses aspire_branch_id INT, not branch_id territory string)
--
-- Idempotent: INSERT IGNORE on all tables + UPDATE with explicit WHERE for
-- branches.lat/lng/region_id (which are excluded from the Aspire reseed UPDATE
-- list per migration 004's Amendment A.2 guard).
--
-- Seed scope (MVP per Amendment A.5):
--   regions           — East Coast / West Coast / Central / South
--   branches.lat/lng/region_id — seeded for a representative set; the
--                       settings handoff adds the admin UI to fill the rest.
--   team_members      — mix of user_id-linked (null placeholder) and null-user rows
--   client_references — one company-wide + one branch-scoped
--   portfolio_properties — two entries (East Coast + Central)
--   insurance_certificates — one current cert (placeholder GCS key)
--
-- Amendment A.1 dedupe note: Fort Myers Install (1403) and Fort Myers
-- Maintenance (3696) share address "5880 Staley Road, Fort Myers, FL 33905".
-- Both carry identical lat/lng. The proximity endpoint dedupes by address
-- (not by aspire_branch_id) so this office appears only once on page 3.
-- ---------------------------------------------------------------------------


-- 1. Regions -----------------------------------------------------------------

INSERT IGNORE INTO `regions` (id, name, sort_order) VALUES
    ('east-coast', 'East Coast', 1),
    ('west-coast', 'West Coast', 2),
    ('central',    'Central',    3),
    -- 'South' appears in hoa_properties.branch_id filter strings (Amendment A.3
    -- note); included here so the vocabulary is in one place even though no
    -- branches are currently assigned to it.
    ('south',      'South',      4);


-- 2. branches.lat / lng / region_id ------------------------------------------
--    UPDATE only (never INSERT — branch rows come from Aspire export reseed).
--    Coordinates are geocoded from the branch address in crm.branches.
--    All three columns are excluded from the Aspire refresh ON DUPLICATE KEY
--    UPDATE in migration 004 (Amendment A.2 guard).

-- Fort Myers Install (1403): 5880 Staley Road, Fort Myers, FL 33905
--   Shares address with Fort Myers Maintenance (3696) — both get identical lat/lng.
UPDATE `branches` SET lat = 26.651900, lng = -81.771800, region_id = 'west-coast'
WHERE aspire_branch_id = 1403 AND lat IS NULL;

-- Fort Myers Maintenance (3696): 5880 Staley Road, Fort Myers, FL 33905
--   Same address as 1403 — identical coordinates (proximity dedupes by address).
UPDATE `branches` SET lat = 26.651900, lng = -81.771800, region_id = 'west-coast'
WHERE aspire_branch_id = 3696 AND lat IS NULL;

-- Bonita Springs Maintenance (1412): 12450 Tower Road, Bonita Springs, FL 34135
UPDATE `branches` SET lat = 26.339500, lng = -81.780900, region_id = 'west-coast'
WHERE aspire_branch_id = 1412 AND lat IS NULL;

-- Naples Maintenance (3697): 212 Price Street, Naples, FL 34112
UPDATE `branches` SET lat = 26.141800, lng = -81.795600, region_id = 'west-coast'
WHERE aspire_branch_id = 3697 AND lat IS NULL;

-- Estero Maintenance (3671): 19490 S. Tamiami Trail, Fort Myers, FL 33908
UPDATE `branches` SET lat = 26.438400, lng = -81.809700, region_id = 'west-coast'
WHERE aspire_branch_id = 3671 AND lat IS NULL;

-- Jupiter Maintenance (3683): 13495 Tournament Drive, Palm Beach Garden, FL 33410
UPDATE `branches` SET lat = 26.852300, lng = -80.086300, region_id = 'east-coast'
WHERE aspire_branch_id = 3683 AND lat IS NULL;

-- West Palm Beach Maintenance (3672): 3801 Dawes Avenue, West Palm Beach, FL 33405
UPDATE `branches` SET lat = 26.695100, lng = -80.059200, region_id = 'east-coast'
WHERE aspire_branch_id = 3672 AND lat IS NULL;

-- Davie Maintenance (3636): 3300 SW 46th Avenue, Davie, FL 33314
UPDATE `branches` SET lat = 26.085900, lng = -80.235000, region_id = 'east-coast'
WHERE aspire_branch_id = 3636 AND lat IS NULL;

-- Melbourne Maintenance (3676): 5105 W Eau Gallie Blvd, Melbourne, FL 32934
UPDATE `branches` SET lat = 28.143300, lng = -80.710600, region_id = 'east-coast'
WHERE aspire_branch_id = 3676 AND lat IS NULL;

-- Vero Beach Maintenance (3577): 6690 US 1, Fort Pierce, FL 34946
UPDATE `branches` SET lat = 27.463400, lng = -80.327400, region_id = 'east-coast'
WHERE aspire_branch_id = 3577 AND lat IS NULL;

-- Central Orlando Maintenance (3668): 7032 Old Cheney Highway, Orlando, FL
UPDATE `branches` SET lat = 28.590700, lng = -81.281200, region_id = 'central'
WHERE aspire_branch_id = 3668 AND lat IS NULL;

-- West Orlando Install (3579): 4000 Avalon Road, Winter Garden, FL 34787
UPDATE `branches` SET lat = 28.546200, lng = -81.572900, region_id = 'central'
WHERE aspire_branch_id = 3579 AND lat IS NULL;

-- West Orlando Maintenance (3699): 4000 Avalon Road, Winter Garden, FL 34787
UPDATE `branches` SET lat = 28.546200, lng = -81.572900, region_id = 'central'
WHERE aspire_branch_id = 3699 AND lat IS NULL;

-- South Orlando Maintenance (3666): 4687 S Orange Blossom Trl, Kissimmee, FL 34746
UPDATE `branches` SET lat = 28.308200, lng = -81.413300, region_id = 'central'
WHERE aspire_branch_id = 3666 AND lat IS NULL;

-- Ocala Maintenance (3694): 9468 S US Hwy 441, Ocala, FL 33480
UPDATE `branches` SET lat = 29.108100, lng = -82.119100, region_id = 'central'
WHERE aspire_branch_id = 3694 AND lat IS NULL;

-- Ocala Install (3674): same address as Maintenance
UPDATE `branches` SET lat = 29.108100, lng = -82.119100, region_id = 'central'
WHERE aspire_branch_id = 3674 AND lat IS NULL;


-- 3. team_members (MVP seed) -------------------------------------------------
--    Assumption: no real users.id values are known at migration time — user_id
--    is seeded NULL for all rows. The settings handoff admin UI will link them
--    to real user records. Non-CRM personnel (production manager, foreman) are
--    permanent null-user rows.

INSERT IGNORE INTO `team_members`
    (id, name, title, team_type, aspire_branch_id, user_id, location, bio,
     headshot_object_key, active, sort_order)
VALUES
-- Regional Director — West Coast (company-wide; aspire_branch_id NULL)
('tm-rd-west-001',
 'Rod Leon',
 'regional_director',
 'branch',
 NULL,   -- company-wide: surfaces on all West Coast branch queries per A.6
 NULL,   -- user_id: link via settings handoff admin UI
 'Southwest Florida',
 'Rod leads Juniper''s West Coast regional operations, overseeing branch performance and client satisfaction across Southwest Florida.',
 NULL,
 1, 0),

-- Regional Director — East Coast (company-wide; aspire_branch_id NULL)
('tm-rd-east-001',
 'Michelle Cady',
 'regional_director',
 'branch',
 NULL,
 NULL,
 'Southeast Florida',
 'Michelle oversees Juniper''s East Coast regional operations, driving consistent portfolio growth and client retention across Florida''s eastern corridor.',
 NULL,
 1, 1),

-- Branch Manager — Fort Myers Install (1403)
('tm-bm-fti-001',
 'Anthony Genca',
 'manager',   -- CANONICAL_ROLES: 'manager' aligns to branch_manager per Amendment A.4
 'branch',
 1403,
 NULL,
 'Fort Myers, FL',
 'Anthony manages the Fort Myers Install branch, leading the installation team across Southwest Florida''s growing commercial and HOA market.',
 NULL,
 1, 0),

-- Branch Manager — Fort Myers Maintenance (3696)
('tm-bm-ftm-001',
 'Alberto Toucet Perez',
 'manager',
 'branch',
 3696,
 NULL,
 'Fort Myers, FL',
 'Alberto oversees the Fort Myers Maintenance branch, ensuring consistent service quality across the branch''s commercial and HOA portfolio.',
 NULL,
 1, 0),

-- Account Manager — Fort Myers (works both branches; scoped to maintenance branch)
('tm-am-ftm-001',
 'CRM Rep Placeholder',
 'account_manager',
 'branch',
 3696,
 NULL,   -- settings handoff links to real user
 'Fort Myers, FL',
 'Account manager serving the Fort Myers commercial and HOA maintenance portfolio.',
 NULL,
 1, 0),

-- Production Manager — null-user (a non-CRM person; permanent null-user row)
('tm-pm-ftm-001',
 'Fort Myers Production Manager',
 'production_manager',
 'branch',
 3696,
 NULL,   -- intentionally null — not a CRM user; managed via settings admin UI
 'Fort Myers, FL',
 'Oversees day-to-day field operations across the Fort Myers maintenance portfolio.',
 NULL,
 1, 1),

-- Executive team — CEO (null aspire_branch_id = company-wide / executive roster)
('tm-exec-ceo-001',
 'Carlos Hernandez',
 'executive',
 'executive',
 NULL,   -- executive roster; team_type='executive' also marks this
 NULL,
 'Fort Myers, FL',
 'Carlos founded Juniper Landscaping with a vision for professional-grade commercial landscape management. Under his leadership, Juniper has grown to serve hundreds of communities across Florida and beyond.',
 NULL,
 1, 0);


-- 4. client_references (MVP seed) --------------------------------------------

INSERT IGNORE INTO `client_references`
    (id, aspire_branch_id, property_name, services_provided,
     contact_name, contact_title, phone, email, address,
     client_since_year, active)
VALUES
-- Company-wide (aspire_branch_id NULL = surfaced for any branch query per A.6)
('cr-001',
 NULL,
 'Coral Bay HOA',
 'Landscape Maintenance, Irrigation, Turf Management',
 'Michelle Cady',
 'Property Manager',
 '(561) 555-0100',
 'mcady@coralbay.com',
 '100 Coral Bay Dr, Jupiter, FL 33458',
 2021,
 1),

-- Fort Myers branch-specific reference
('cr-002',
 3696,   -- Fort Myers Maintenance
 'Pointe Jupiter Yacht Club',
 'Landscape Maintenance, Irrigation, Aquatics',
 'Thomas Bridges',
 'Property Manager',
 '(239) 555-0142',
 'tbridges@pointejupiter.com',
 '1 Yacht Club Dr, Fort Myers, FL 33908',
 2020,
 1);


-- 5. portfolio_properties (MVP seed) -----------------------------------------

INSERT IGNORE INTO `portfolio_properties`
    (id, name, city_state, region_id, photo_object_keys,
     before_after_object_keys, sort_order)
VALUES
-- East Coast
('pp-001',
 'Pointe Jupiter Yacht Club',
 'Jupiter, FL',
 'east-coast',
 '[]',   -- GCS keys populated when photos are migrated from SharePoint
 NULL,
 0),

-- Central
('pp-002',
 'Coral Bay Community Entrance',
 'Orlando, FL',
 'central',
 '[]',
 NULL,
 0),

-- West Coast
('pp-003',
 'Fort Myers Harbour District Plaza',
 'Fort Myers, FL',
 'west-coast',
 '[]',
 NULL,
 0);


-- 6. insurance_certificates (one current cert) --------------------------------
--    Real cert to be uploaded via the settings handoff admin UI.
--    GCS key is a placeholder following Handoff-26 naming convention.

INSERT IGNORE INTO `insurance_certificates`
    (id, object_key, expiry_date, label, uploaded_at)
VALUES
('ins-cert-001',
 'proposal/insurance/juniper-certificate-of-liability-2026.pdf',
 '2027-03-31',
 'General Liability',
 '2026-08-26 00:00:00');
