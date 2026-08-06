-- ---------------------------------------------------------------------------
-- branches — per-branch registry (one row per Aspire BranchID), Handoff 18.
--
-- The canonical registry of physical Aspire branches, mirrored verbatim from
-- the Aspire branches export. sales_territories routes each "City, ST" unit to
-- one of these BranchIDs per service line (maintenance/install).
--
-- ⚠️ The live database is `crm`, NOT `juniper` — apply via the unprefixed
-- migration sql/migrations/004_users_and_branches.sql. This juniper-prefixed
-- file keeps the create_table DDL set complete (recreate-from-scratch source).
--
-- Seed block below is the 2025-10-22 Aspire snapshot (refreshed through
-- 2026-07). Inactive + "DO NOT USE" rows are kept for fidelity; the live
-- operating roster is WHERE active = 1 AND branch_name NOT LIKE '%DO NOT USE%'.
-- Idempotent (ON DUPLICATE KEY UPDATE on the BranchID PK) — safe to re-run.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `juniper`.`branches` (
    aspire_branch_id   INT          NOT NULL,           -- Aspire BranchID (the real PK)
    branch_name        VARCHAR(255) NOT NULL,
    active             TINYINT(1)   NOT NULL DEFAULT 1,
    branch_code        VARCHAR(10)  NULL DEFAULT NULL,   -- 3-letter Aspire code (BRI, WOM, …)
    address1           VARCHAR(255) NULL DEFAULT NULL,
    city               VARCHAR(100) NULL DEFAULT NULL,
    state              CHAR(2)      NULL DEFAULT NULL,
    zip                VARCHAR(20)  NULL DEFAULT NULL,
    phone              VARCHAR(40)  NULL DEFAULT NULL,
    manager_contact_id INT          NULL DEFAULT NULL,   -- Aspire ContactID of the branch manager
    manager_name       VARCHAR(255) NULL DEFAULT NULL,
    legal_name         VARCHAR(255) NULL DEFAULT NULL,   -- operating entity (some branches run under partner LLCs)
    time_zone          VARCHAR(50)  NULL DEFAULT NULL,
    PRIMARY KEY (aspire_branch_id),
    INDEX idx_branches_active (active),
    INDEX idx_branches_state (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verbatim mirror of the Aspire branches export (2025-10-22 snapshot, refreshed
-- through 2026-07). Keeps inactive + "DO NOT USE" rows for fidelity; the live
-- operating roster is: WHERE active = 1 AND branch_name NOT LIKE '%DO NOT USE%'.
-- Idempotent (ON DUPLICATE KEY UPDATE on the BranchID PK) — safe to re-run to
-- refresh from a newer export.
INSERT INTO `juniper`.`branches`
    (aspire_branch_id, branch_name, active, branch_code, address1, city, state, zip,
     phone, manager_contact_id, manager_name, legal_name, time_zone) VALUES
    (1374, 'Bradenton Install', 1, 'BRI', '2504 64th Street Court East', 'Bradenton', 'FL', '34208', '(239) 561-5980', 716118, 'MICHAEL LARSEN', 'Juniper Landscaping of Floridca LLC', 'Eastern Standard Time'),
    (1401, 'DO NOT USE - Naples Install', 1, 'NPI', '212 Price Street', 'Naples', 'FL', '34112', '(239) 561-5980', 720541, 'JASON HAMMOND', 'Juniper Landscaping of Floridca LLC', 'Eastern Standard Time'),
    (1402, 'Venice Install', 1, 'VNI', '10620 Peach Lily Path', 'North Port', 'FL', '34293', '(239) 561-5980', 278691, 'ANTHONY GARTNER', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (1403, 'Fort Myers Install', 1, 'FTI', '5880 Staley Road', 'Fort Myers', 'FL', '33905', '(239) 561-5980', 278727, 'ANTHONY GENCA', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (1412, 'Bonita Springs Maintenance', 1, 'BON', '12450 Tower Road', 'Bonita Springs', 'FL', '34135', '(239) 561-5980', 720541, 'JASON HAMMOND', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (1919, 'Fort Lauderdale (DO NOT USE)', 0, 'FTL', '3300 Burris Rd', 'Davie', 'FL', '33314', '954-584-3465', 538836, 'THOMAS JACOB', 'Prestige Property Maintenance Inc', 'Eastern Standard Time'),
    (2224, '*** PICK A BRANCH ***', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    (3577, 'Vero Beach Maintenance', 1, 'VER', '6690 US 1', 'Fort Pierce', 'FL', '34946', '(239) 561-5980', 739885, 'KYLE MCNAMARA', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3579, 'West Orlando Install', 1, 'WOI', '4000 Avalon Road', 'Winter Garden', 'FL', '34787', '(239) 561-5980', 811234, 'BRET WOLF', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3636, 'Davie Maintenance', 1, 'DAV', '3300 SW 46th Avenue', 'Davie', 'FL', '33314', '(954) 584-3465', 538836, 'THOMAS JACOB', 'Juniper Landscaping of Floridca LLC', 'Eastern Standard Time'),
    (3663, 'Tampa South Maintenance', 1, 'TSM', '5571 Center Street', 'Wimauma', 'FL', '33598', '(239) 561-5980', 800313, 'JUAN CARLOS NOVA', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3664, 'General Holding', 1, 'GEN', '5880 Staley Road', 'Fort Myers', 'FL', '33905', '239-771-8344', 258555, 'Jennifer Hux-Aklar - TERM', 'General Holding (INTERNAL)', NULL),
    (3665, 'East Orlando (ARY) - DO NOT USE', 0, 'EOR', '755 Hancock Lone Palm Road', 'Orlando', 'FL', '32828', '407-810-1174', NULL, NULL, 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3666, 'South Orlando Maintenance', 1, 'SOR', '4687 S Orange Blossom Trl', 'Kissimmee', 'FL', '34746', '(239) 561-5980', 800249, 'MATTHEW DEAN', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3668, 'Central Orlando Maintenance', 1, 'COR', '7032 Old Cheney Highway', 'Orlando', 'FL', NULL, '(239) 561-5980', 796731, 'ROBERT BENAVIDEZ JR', NULL, 'Eastern Standard Time'),
    (3669, 'DO NOT USE - Lakeland (CLM)', 0, 'LAK', '3545 Waterfield Rd', 'Lakeland', 'FL', NULL, '863-327-2063', NULL, NULL, NULL, 'Eastern Standard Time'),
    (3670, 'DO NOT USE - Sod Install Central - CF', 1, 'SOD', '4000 Avalon Road', 'Winter Garden', 'FL', '34787', '(239) 561-5980', 278728, 'LEWIS MAROTTI', 'Juniper Landscaping of Florida, LLC', 'Eastern Standard Time'),
    (3671, 'Estero Maintenance', 1, 'EST', '19490 S. Tamiami Trail', 'Fort Myers', 'FL', '33908', '239-267-1133', 655636, 'JOSE FERRO', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3672, 'West Palm Beach Maintenance', 1, 'WPB', '3801 Dawes Avenue', 'West Palm Beach', 'FL', '33405', '561-436-9404', 808300, 'BRENT YOHE', 'Yohe''s Lawn Care and Landscape', 'Eastern Standard Time'),
    (3673, 'Riviera Beach Sports Turf', 1, 'RBM', '3300 SW 46th Avenue', 'Davie', 'FL', '33314', '954-584-3465', 713227, 'RICARDO PERAZA', 'Juniper Landscaping of Floridca LLC', 'Eastern Standard Time'),
    (3674, 'Ocala Install', 1, 'OCI', '9468 S Us Hwy 441', 'Ocala', 'FL', '34480', '(239) 561-5980', 811234, 'BRET WOLF', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3675, 'DO NOT USE - Arbor', 0, 'ARB', '5880 Staley Road', 'Fort Myers', 'FL', '33905', '239-561-5980', 278698, 'NICHOLAS SALERNO', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3676, 'Melbourne Maintenance', 1, 'MEL', '5105 W Eau Gallie Blvd', 'Melbourne', 'FL', '32934', '(239) 561-5980', 821842, 'DAVID THOMAS', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3677, 'Tampa North Install', 1, 'TNI', '11939 Emmaus Cemetery Road', 'San Antonio', 'FL', '33576', '(239) 561-5980', 716118, 'MICHAEL LARSEN', 'Juniper Landscaping of Florida, LLC', 'Eastern Standard Time'),
    (3678, 'DO NOT USE- Palm Bay', 0, 'PLB', '1901 Danr Drive NE', 'Palm Bay', 'FL', '32095', NULL, 814047, 'JOHN ANDERSON', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3679, 'Houston Maintenance', 1, 'HSM', '27271 Katy Fwy', 'Katy', 'TX', '77494', '281-392-3607', 816032, 'BRIAN SCHMITT', 'Shooter & Lindsey, Inc', 'Central Standard Time'),
    (3680, 'Houston Install', 1, 'HSI', '27271 Katy Fwy', 'Katy', 'TX', '77494', '281-392-3607', 816032, 'BRIAN SCHMITT', 'Shooter & Lindsey, Inc', 'Central Standard Time'),
    (3681, 'Tyndall Install', 1, 'PCI', '429 S Tyndall Pkwy Suite O', 'Panama City Beach', 'FL', '32404', '(239) 561-5980', 716118, 'MICHAEL LARSEN', 'Juniper Landscaping of Florida LLC', 'Central Standard Time'),
    (3682, 'Panama City Beach Maintenance', 1, 'PCM', '511 N Highway 79', 'Panama City Beach', 'FL', '32413', '(850) 233-6396', 837970, 'BRIAN CALKINS', 'Rips Professional Lawncare LLC', 'Central Standard Time'),
    (3683, 'Jupiter Maintenance', 1, 'JUM', '13495 Tournament Drive', 'Palm Beach Garden', 'FL', '33410', '(561) 557-1655', 814261, 'MICHAEL BURAK', 'Elegant Landscape & Design Inc.', 'Eastern Standard Time'),
    (3684, 'Bradenton Maintenance', 1, 'BRM', '2504 64th Street Court East', 'Bradenton', 'FL', '34208', '(239) 561-5980', 805067, 'Douglas Orange', 'Juniper Landscaping of Floridca LLC', 'Eastern Standard Time'),
    (3685, 'Tyndall Maintenance', 1, 'TYM', '511 N Highway 79', 'Panama City Beach', 'FL', '32413', NULL, 829845, 'ADAM WADE', 'Juniper Landscaping of Floridca LLC', 'Central Standard Time'),
    (3686, 'Harrisburg Maintenance', 1, 'HAM', '2340 Paxton Church Road', 'Harrisburg', 'PA', '17110', '717-545-4235', 821740, 'JESSE SILFIES', 'Davis Landscape LTD', 'Eastern Standard Time'),
    (3687, 'Hershey Maintenance', 1, 'HEM', '10 Northeast Drive', 'Hershey', 'PA', '17033', '717-545-4235', 821739, 'BRET CALDERWOOD', 'Davis Landscape LTD', 'Eastern Standard Time'),
    (3688, 'Raleigh Maintenance', 1, 'RAM', '2900 Garner Station Blvd', 'Raleigh', 'NC', '27603', '919-662-1009', 821742, 'NOAH TURNER', 'Davis Landscape LTD', 'Eastern Standard Time'),
    (3689, 'Raleigh Install', 1, 'RAI', '64 Rupert Road', 'Raleigh', 'NC', '27603', '919-662-1009', 821741, 'CHRISTOPHER WARD', 'Davis Landscape LTD', 'Eastern Standard Time'),
    (3690, 'Golden Palms on Orange River', 1, 'GPN', '11801 Orange River Blvd', 'Fort Myers', 'FL', '33905', NULL, 258561, 'MICHAEL DUKE', NULL, 'Eastern Standard Time'),
    (3691, 'Tampa East Maintenance', 1, 'TEM', '13050 E US Highway 92', 'Dover', 'FL', '33527', '8137576500', 826236, 'GARTH RINARD', 'Landscape Maintenance Professionals, LLC', 'Eastern Standard Time'),
    (3692, 'DO NOT USE- Sarasota Maintenance', 1, 'SAM', '1306 Rome Ave', 'Sarasota', 'FL', '34243', '941-556-9404', 826235, 'CHRISTOPHER BERRY', 'Landscape Maintenance Professionals, LLC', 'Eastern Standard Time'),
    (3693, 'DO NOT USE-New Tampa Maintenance', 1, 'NTM', '26324 Wesley Chapel Blvd', 'Lutz', 'FL', '33559', '813-406-4465', 826237, 'ROYAL CONRAD', 'Landscape Maintenance Professionals, LLC', 'Eastern Standard Time'),
    (3694, 'Ocala Maintenance', 1, 'OCM', '9468 S Us Hwy 441', 'Ocala', 'FL', '33480', '(239) 561-5980', 798243, 'KEITH KIRCHOFFER', 'Ocala Maintenance', 'Eastern Standard Time'),
    (3695, 'Tampa North Maintenance', 1, 'TNM', '11939 Emmaus Cemetery Road', 'San Antonio', 'FL', '33576', '(239) 561-5980', 829092, 'Matt Gerich', 'Tampa North Maintenance', 'Eastern Standard Time'),
    (3696, 'Fort Myers Maintenance', 1, 'FTM', '5880 Staley Road', 'Fort Myers', 'FL', '33905', '(239) 561-5980', 298325, 'ALBERTO TOUCET PEREZ', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3697, 'Naples Maintenance', 1, 'NPM', '212 Price Street', 'Naples', 'FL', '34112', '(239) 561-5980', 744726, 'CATARINO MARTINEZ', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3698, 'Venice Maintenance', 1, 'VNM', '533 Paul Morris Drive', 'Englewood', 'FL', '34223', '(239) 561-5980', 663761, 'EDWARD TANGUAY', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3699, 'West Orlando Maintenance', 1, 'WOM', '4000 Avalon Road', 'Winter Garden', 'FL', '34787', '(239) 561-5980', 812931, 'Matthew TERMED Shelton', 'Juniper Landscaping of Florida LLC', 'Eastern Standard Time'),
    (3700, 'Learning & Development', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    (3701, 'Contract and Billing', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    (3702, 'Aquatics Central Florida', 1, 'ACF', '4230 Fanny Bass Road', 'St. Cloud', 'FL', '34772', '(407) 205-2537', 832511, 'BRETT COLLINS', 'Aquatics Weeds, LLC', 'Eastern Standard Time'),
    (3703, 'Training Branch', 1, NULL, NULL, NULL, NULL, NULL, NULL, 800360, 'JARRETT MYERS', NULL, 'Eastern Standard Time'),
    (3704, 'West Orlando Aquatics', 1, 'WOA', '4000 Avalon Road', 'Winter Garden', 'FL', '34787', NULL, 840735, 'JORDON SPEARS', 'Compass Environmental', 'Eastern Standard Time'),
    (3705, 'Daytona Maintenance', 1, 'DAM', '1635 Patterson Avenue', 'DeLand', 'FL', '32724', NULL, 840905, 'SEAN YUNKER', 'Juniper Landscaping of Florida, LLC', 'Eastern Standard Time'),
    (3706, 'Hilton Head Maintenance', 1, 'HHM', '31 Mathews Drive', 'Hilton Head Island', 'SC', '29926', '(843) 681-2889', 842682, 'NICK WELLIVER', 'Hilton Head Landscapes LLC', 'Eastern Standard Time'),
    (3707, 'Hilton Head Install', 1, 'HHI', '31 Mathews Drive', 'Hilton Head Island', 'SC', '29926', '(843) 681-2889', 842682, 'NICK WELLIVER', 'Hilton Head Landscapes LLC', 'Eastern Standard Time'),
    (3708, 'Do Not Use', 0, NULL, NULL, 'Dover', NULL, NULL, NULL, NULL, NULL, 'Juniper Landscaping of Florida LLC', NULL),
    (3709, 'Training Branch EC', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Eastern Standard Time')
ON DUPLICATE KEY UPDATE
    branch_name = VALUES(branch_name), active = VALUES(active), branch_code = VALUES(branch_code),
    address1 = VALUES(address1), city = VALUES(city), state = VALUES(state), zip = VALUES(zip),
    phone = VALUES(phone), manager_contact_id = VALUES(manager_contact_id),
    manager_name = VALUES(manager_name), legal_name = VALUES(legal_name), time_zone = VALUES(time_zone);
