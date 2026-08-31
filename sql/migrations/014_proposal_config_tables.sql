-- ---------------------------------------------------------------------------
-- Migration 014 — Handoff 37, Slice 3: Proposal config schema (Amendment A)
--
-- Amendment A.2: Do NOT create branch_profiles — crm.branches already exists.
--   Instead, ALTER crm.branches to add lat, lng, region_id.
--   IMPORTANT: the Aspire refresh ON DUPLICATE KEY UPDATE statement in
--   sql/migrations/004_users_and_branches.sql explicitly EXCLUDES these three
--   columns so a reseed cannot wipe them. See migration 004 for the amended
--   UPDATE list.
--
-- Amendment A.3: region is a config table (crm.regions), not a union type.
--   branches.region_id → crm.regions.id (logical FK; no constraint per repo
--   convention).
--
-- Amendment A.4: team_members.user_id links to users.id; team_members.title
--   aligns to CANONICAL_ROLES (branch_manager → manager).
--   aspire_branch_id (INT) replaces the old branch_id (VARCHAR territory string).
--
-- Tables created:
--   crm.regions            — proposal region config (East Coast / West Coast / Central / South)
--   crm.team_members       — persons eligible to appear in a proposal
--   crm.client_references  — client references per branch or company-wide
--   crm.portfolio_properties — portfolio photos scoped by region
--   crm.insurance_certificates — current cert metadata (GCS object key + expiry)
--
-- Columns added:
--   crm.branches.lat        DECIMAL(9,6) NULL
--   crm.branches.lng        DECIMAL(9,6) NULL
--   crm.branches.region_id  VARCHAR(36)  NULL → crm.regions.id
--
-- No FK constraints — relationships are logical/indexed (repo convention).
-- Money: none on these tables.
-- Object keys follow the GCS pattern established in Handoff 26.
-- ---------------------------------------------------------------------------

-- 1. regions config table ---------------------------------------------------
--    id is a human-readable slug (e.g. 'east-coast') so SQL joins are readable.

CREATE TABLE IF NOT EXISTS `regions` (
    `id`          VARCHAR(36)   NOT NULL,   -- e.g. 'east-coast'
    `name`        VARCHAR(100)  NOT NULL,   -- e.g. 'East Coast'
    `sort_order`  INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY uq_regions_name (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 2. ALTER branches — add lat, lng, region_id --------------------------------
--    ADD COLUMN ... IF NOT EXISTS is not supported in MySQL 8.0, and a raw
--    ADD COLUMN is not re-runnable if the migration ever partially fails after
--    this point (e.g. a later CREATE errors). Guard each column with dynamic
--    SQL keyed on information_schema so the ALTER is idempotent in every case.
--    All three columns are excluded from the Aspire reseed UPDATE list in
--    migration 004 so a reseed cannot wipe them.

SET @add_lat = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'lat') > 0, 'SELECT 1', 'ALTER TABLE `branches` ADD COLUMN `lat` DECIMAL(9,6) NULL DEFAULT NULL COMMENT ''Decimal latitude — excluded from Aspire reseed UPDATE list (migration 014)''');
PREPARE stmt_lat FROM @add_lat;
EXECUTE stmt_lat;
DEALLOCATE PREPARE stmt_lat;

SET @add_lng = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'lng') > 0, 'SELECT 1', 'ALTER TABLE `branches` ADD COLUMN `lng` DECIMAL(9,6) NULL DEFAULT NULL COMMENT ''Decimal longitude — excluded from Aspire reseed UPDATE list (migration 014)''');
PREPARE stmt_lng FROM @add_lng;
EXECUTE stmt_lng;
DEALLOCATE PREPARE stmt_lng;

SET @add_region = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'branches' AND column_name = 'region_id') > 0, 'SELECT 1', 'ALTER TABLE `branches` ADD COLUMN `region_id` VARCHAR(36) NULL DEFAULT NULL COMMENT ''FK to regions.id — excluded from Aspire reseed UPDATE list (migration 014)''');
PREPARE stmt_region FROM @add_region;
EXECUTE stmt_region;
DEALLOCATE PREPARE stmt_region;


-- 3. team_members ------------------------------------------------------------
--    title aligns to CANONICAL_ROLES in api/authz.py where a match exists:
--      branch_manager → manager (per Amendment A.4)
--    Proposal-specific titles (account_manager, agronomy_manager,
--    irrigation_manager, production_manager, executive) have no canonical
--    equivalent and are kept as-is.

CREATE TABLE IF NOT EXISTS `team_members` (
    `id`                  VARCHAR(36)   NOT NULL,
    `name`                VARCHAR(150)  NOT NULL,
    -- Aligned to api/authz.py CANONICAL_ROLES where applicable (see A.4).
    `title`               VARCHAR(50)   NOT NULL,   -- see TeamMemberTitle in proposal.ts
    `team_type`           ENUM('branch', 'executive') NOT NULL,
    -- Aspire BranchID; NULL = company-wide / executive roster.
    `aspire_branch_id`    INT           NULL DEFAULT NULL,
    -- When set, name/title/branch derive from users + user_branches.
    -- NULL for non-CRM people (production managers, foremen).
    `user_id`             VARCHAR(36)   NULL DEFAULT NULL,
    `location`            VARCHAR(150)  NULL DEFAULT NULL,
    `bio`                 TEXT          NOT NULL,   -- TEXT cannot carry a DEFAULT in MySQL; all inserts supply it
    -- GCS object key — same pattern as intake_attachments.object_key (Handoff 26).
    `headshot_object_key` VARCHAR(500)  NULL DEFAULT NULL,
    `active`              TINYINT(1)    NOT NULL DEFAULT 1,
    `sort_order`          INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    INDEX idx_team_members_branch (`aspire_branch_id`),
    INDEX idx_team_members_user   (`user_id`),
    INDEX idx_team_members_type   (`team_type`),
    INDEX idx_team_members_active (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 4. client_references -------------------------------------------------------
--    aspire_branch_id NULL = company-wide (shown for any branch query per A.6).

CREATE TABLE IF NOT EXISTS `client_references` (
    `id`                  VARCHAR(36)   NOT NULL,
    -- Aspire BranchID; NULL = company-wide (usable by any branch).
    `aspire_branch_id`    INT           NULL DEFAULT NULL,
    `property_name`       VARCHAR(200)  NOT NULL,
    `services_provided`   VARCHAR(500)  NOT NULL,
    `contact_name`        VARCHAR(150)  NOT NULL,
    `contact_title`       VARCHAR(150)  NULL DEFAULT NULL,
    `phone`               VARCHAR(30)   NOT NULL,
    `email`               VARCHAR(150)  NOT NULL,
    `address`             VARCHAR(255)  NOT NULL,
    `client_since_year`   SMALLINT      NOT NULL,
    `active`              TINYINT(1)    NOT NULL DEFAULT 1,
    PRIMARY KEY (`id`),
    INDEX idx_client_refs_branch (`aspire_branch_id`),
    INDEX idx_client_refs_active (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 5. portfolio_properties ----------------------------------------------------
--    region_id → regions.id (logical FK; no constraint per repo convention).
--    photo_object_keys / before_after_object_keys: JSON arrays of GCS keys.

CREATE TABLE IF NOT EXISTS `portfolio_properties` (
    `id`                        VARCHAR(36)   NOT NULL,
    `name`                      VARCHAR(200)  NOT NULL,
    `city_state`                VARCHAR(100)  NOT NULL,
    -- FK → regions.id (logical — no constraint per convention).
    `region_id`                 VARCHAR(36)   NOT NULL,
    -- JSON array of GCS object keys (same pattern as IntakeAttachment.objectKey).
    `photo_object_keys`         TEXT          NOT NULL,   -- JSON array; TEXT cannot carry a DEFAULT in MySQL, inserts supply '[]'
    -- JSON: {"before": "<key>", "after": "<key>"} or NULL.
    `before_after_object_keys`  TEXT          NULL DEFAULT NULL,
    `sort_order`                INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    INDEX idx_portfolio_region (`region_id`),
    INDEX idx_portfolio_sort   (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 6. insurance_certificates --------------------------------------------------
--    One active cert at a time (the settings handoff adds a renewal warning off
--    expiry_date). Settings handoff manages upload/renewal.
--    label is optional — useful when tracking multiple policy types in future.

CREATE TABLE IF NOT EXISTS `insurance_certificates` (
    `id`           VARCHAR(36)   NOT NULL,
    -- GCS object key — same pattern as Handoff 26.
    `object_key`   VARCHAR(500)  NOT NULL,
    `expiry_date`  DATE          NOT NULL,
    `label`        VARCHAR(100)  NULL DEFAULT NULL,   -- e.g. 'General Liability'
    `uploaded_at`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX idx_insurance_expiry (`expiry_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
