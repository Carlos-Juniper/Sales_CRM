-- ---------------------------------------------------------------------------
-- Estimating schema — LOCAL / crm-database apply script.
--
-- Same objects as estimating.sql, but WITHOUT the `juniper.` schema prefix so
-- it can be applied directly to the `crm` database that local dev connects to
-- (MYSQL_DB=crm via the Cloud SQL proxy). Keep this in sync with estimating.sql.
--
-- Apply:
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p crm < sql/estimating_crm.sql
-- (or paste into your SQL client with the `crm` database selected).
--
-- Money is integer cents (BIGINT `*_cents`); percentages are decimals (0.22 = 22%).
-- ---------------------------------------------------------------------------

-- §3.1 estimates -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estimates (
    id                      VARCHAR(36)   NOT NULL,
    estimate_type           ENUM('maintenance','install') NOT NULL,   -- IMMUTABLE after insert
    name                    TEXT          NOT NULL,
    aspire_number           VARCHAR(50)   DEFAULT NULL,
    client_name             VARCHAR(255)  NOT NULL,
    branch                  VARCHAR(100)  NOT NULL,
    customer_type           VARCHAR(30)   NOT NULL,
    acreage                 DECIMAL(10,2) DEFAULT NULL,
    contract_value_cents    BIGINT        NOT NULL DEFAULT 0,
    target_margin           DECIMAL(6,4)  NOT NULL DEFAULT 0.2200,
    status                  ENUM('new_from_sales','queued','in_progress','review',
                                 'pending_approval','approved','handed_back','won','lost')
                                          NOT NULL DEFAULT 'new_from_sales',
    lifecycle               ENUM('bidding','won') NOT NULL DEFAULT 'bidding',
    aspire_owner            ENUM('estimating','crm') NOT NULL DEFAULT 'estimating',
    priority                ENUM('urgent','high','medium') NOT NULL DEFAULT 'medium',
    win_probability         DECIMAL(4,2)  NOT NULL DEFAULT 0.20,
    site_walk_date          DATE          DEFAULT NULL,
    due_back_date           DATE          NOT NULL,
    anticipated_close_date  DATE          DEFAULT NULL,
    service_start_date      DATE          DEFAULT NULL,
    assigned_ls_estimator   VARCHAR(36)   DEFAULT NULL,
    assigned_irr_estimator  VARCHAR(36)   DEFAULT NULL,
    crm_rep                 VARCHAR(36)   DEFAULT NULL,
    notify_bm_rd_on_return  TINYINT(1)    NOT NULL DEFAULT 1,     -- approvalSettings.notifyBmRdOnReturn
    notes                   TEXT          DEFAULT NULL,           -- optional queue-card notes
    property_id             VARCHAR(36)   DEFAULT NULL,           -- properties.id (source of truth)
    aspire_opportunity_id   INT           DEFAULT NULL,           -- Aspire OpportunityID (write-back key)
    aspire_lost_reason_id   INT           DEFAULT NULL,           -- captured at the lost transition
    aspire_sync_status      ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
    aspire_sync_error       TEXT          DEFAULT NULL,
    aspire_synced_at        DATETIME      DEFAULT NULL,
    created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_estimates_type        (estimate_type),
    INDEX idx_estimates_status      (status),
    INDEX idx_estimates_branch      (branch),
    INDEX idx_estimates_due_back    (due_back_date),
    INDEX idx_estimates_ls_est      (assigned_ls_estimator),
    INDEX idx_estimates_sync_status (aspire_sync_status),
    INDEX idx_estimates_property_id (property_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §2 estimate_type immutability guard (DB-level; mirrored in the app layer).
DROP TRIGGER IF EXISTS trg_estimates_type_immutable;
DELIMITER $$
CREATE TRIGGER trg_estimates_type_immutable
BEFORE UPDATE ON estimates
FOR EACH ROW
BEGIN
    IF NEW.estimate_type <> OLD.estimate_type THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'estimate_type is immutable and cannot be changed after creation';
    END IF;
END$$
DELIMITER ;

-- §3.2b estimate_status_transitions (audit trail — actor + timestamp per edge).
CREATE TABLE IF NOT EXISTS estimate_status_transitions (
    id           VARCHAR(36)  NOT NULL,
    estimate_id  VARCHAR(36)  NOT NULL,
    from_status  VARCHAR(30)  NOT NULL,
    to_status    VARCHAR(30)  NOT NULL,
    actor        VARCHAR(255) NOT NULL,
    at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_transitions_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id) ON DELETE CASCADE,
    INDEX idx_transitions_estimate (estimate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.3 estimate_sections ------------------------------------------------------
CREATE TABLE IF NOT EXISTS estimate_sections (
    id           VARCHAR(36)   NOT NULL,
    estimate_id  VARCHAR(36)   NOT NULL,
    name         VARCHAR(255)  NOT NULL,
    square_feet  DECIMAL(12,2) NOT NULL DEFAULT 0,
    sort_order   INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT fk_sections_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id) ON DELETE CASCADE,
    INDEX idx_sections_estimate (estimate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.6 catalog_items / kits ---------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_items (
    id               VARCHAR(36)   NOT NULL,
    description      VARCHAR(255)  NOT NULL,
    uom              VARCHAR(20)   NOT NULL,
    unit_cost_cents  BIGINT        NOT NULL DEFAULT 0,
    unit_sell_cents  BIGINT        NOT NULL DEFAULT 0,
    target_gm        DECIMAL(6,4)  NOT NULL DEFAULT 0,
    kit_type         ENUM('maintenance_hours','install_quantity') NOT NULL,
    production_rate  DECIMAL(10,4) DEFAULT NULL,
    branch           VARCHAR(100)  NOT NULL,
    active           TINYINT(1)    NOT NULL DEFAULT 1,
    service_type     VARCHAR(100)  NOT NULL,
    created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_catalog_kit_type (kit_type),
    INDEX idx_catalog_branch   (branch),
    INDEX idx_catalog_active   (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.4 section_services -------------------------------------------------------
CREATE TABLE IF NOT EXISTS section_services (
    id                  VARCHAR(36)   NOT NULL,
    section_id          VARCHAR(36)   NOT NULL,
    catalog_item_id     VARCHAR(36)   DEFAULT NULL,
    label               VARCHAR(255)  NOT NULL,
    qty                 DECIMAL(12,4) NOT NULL DEFAULT 0,
    uom                 VARCHAR(20)   NOT NULL,
    complexity_pct      DECIMAL(6,4)  NOT NULL DEFAULT 0,
    unit_sell_cents     BIGINT        DEFAULT NULL,
    embedded_cost_cents BIGINT        DEFAULT NULL,
    target_gm           DECIMAL(6,4)  DEFAULT NULL,
    hours               DECIMAL(10,4) DEFAULT NULL,
    sort_order          INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT fk_services_section
        FOREIGN KEY (section_id) REFERENCES estimate_sections (id) ON DELETE CASCADE,
    CONSTRAINT fk_services_catalog_item
        FOREIGN KEY (catalog_item_id) REFERENCES catalog_items (id) ON DELETE SET NULL,
    INDEX idx_services_section (section_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.5 section_service_components ---------------------------------------------
CREATE TABLE IF NOT EXISTS section_service_components (
    id                 VARCHAR(36)   NOT NULL,
    section_service_id VARCHAR(36)   NOT NULL,
    kind               ENUM('labor','material') NOT NULL,
    label              VARCHAR(255)  NOT NULL,
    qty                DECIMAL(12,4) NOT NULL DEFAULT 0,
    unit_cost_cents    BIGINT        NOT NULL DEFAULT 0,
    hours              DECIMAL(10,4) DEFAULT NULL,
    sort_order         INT           NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT fk_components_service
        FOREIGN KEY (section_service_id) REFERENCES section_services (id) ON DELETE CASCADE,
    INDEX idx_components_service (section_service_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.7 material_calcs ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS material_calcs (
    id                        VARCHAR(36)  NOT NULL,
    material_key              VARCHAR(50)  NOT NULL,
    label                     VARCHAR(255) NOT NULL,
    compute_type              ENUM('divPiece','divRoll','aggregate','sod','mulch','fert','backfill') NOT NULL,
    factors                   JSON         NOT NULL,
    unit_sell_cents           BIGINT       NOT NULL DEFAULT 0,
    unit_cost_cents           BIGINT       NOT NULL DEFAULT 0,
    uom                       VARCHAR(20)  NOT NULL,
    volume_quote_threshold_sf INT          DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_material_key (material_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.8 takeoff_lines ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS takeoff_lines (
    id              VARCHAR(36)   NOT NULL,
    estimate_id     VARCHAR(36)   NOT NULL,
    description     VARCHAR(255)  NOT NULL,
    uom             VARCHAR(20)   NOT NULL,
    plan_qty        DECIMAL(14,4) NOT NULL DEFAULT 0,
    add_pct         DECIMAL(6,4)  NOT NULL DEFAULT 0,
    measured_qty    DECIMAL(14,4) NOT NULL DEFAULT 0,
    opportunity_qty DECIMAL(14,4) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    CONSTRAINT fk_takeoff_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id) ON DELETE CASCADE,
    INDEX idx_takeoff_estimate (estimate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.9 approval_tiers ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_tiers (
    id              VARCHAR(36)  NOT NULL,
    role_key        ENUM('branch_manager','regional_director','bp','coo') NOT NULL,
    label           VARCHAR(100) NOT NULL,
    min_value_cents BIGINT       NOT NULL,
    max_value_cents BIGINT       DEFAULT NULL,
    tier_order      INT          NOT NULL,
    estimate_type   ENUM('maintenance','install') NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_tiers_type_order (estimate_type, tier_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.10 ITB tracker -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS itb_scopes (
    id          VARCHAR(36)  NOT NULL,
    scope_key   VARCHAR(50)  NOT NULL,
    label       VARCHAR(100) NOT NULL,
    scope_group ENUM('estimating','outside_dept','vendor_only') NOT NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_scope_key (scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS itb_projects (
    id                VARCHAR(36)   NOT NULL,
    name              VARCHAR(255)  NOT NULL,
    aspire_number     VARCHAR(50)   DEFAULT NULL,
    branch            VARCHAR(100)  NOT NULL,
    sales_rep         VARCHAR(36)   DEFAULT NULL,
    ls_estimator      VARCHAR(36)   DEFAULT NULL,
    irr_estimator     VARCHAR(36)   DEFAULT NULL,
    irr_designer      VARCHAR(36)   DEFAULT NULL,
    bid_number        VARCHAR(50)   DEFAULT NULL,
    itb_date          DATE          NOT NULL,
    due_date          DATE          NOT NULL,
    rebid             TINYINT(1)    NOT NULL DEFAULT 0,
    est_total_cents   BIGINT        NOT NULL DEFAULT 0,
    est_ls_cents      BIGINT        NOT NULL DEFAULT 0,
    est_ir_cents      BIGINT        NOT NULL DEFAULT 0,
    client            VARCHAR(255)  NOT NULL,
    quarter           VARCHAR(10)   NOT NULL,
    notes             TEXT          DEFAULT NULL,
    created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_itb_due_date (due_date),
    INDEX idx_itb_branch   (branch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS itb_scope_status (
    project_id  VARCHAR(36) NOT NULL,
    scope_id    VARCHAR(36) NOT NULL,
    status_code ENUM('P','C','S','R','U','X','-','E','I') NOT NULL DEFAULT 'P',
    PRIMARY KEY (project_id, scope_id),
    CONSTRAINT fk_itb_status_project
        FOREIGN KEY (project_id) REFERENCES itb_projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_itb_status_scope
        FOREIGN KEY (scope_id) REFERENCES itb_scopes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.11 intake_submissions + attachments --------------------------------------
CREATE TABLE IF NOT EXISTS intake_submissions (
    id            VARCHAR(36) NOT NULL,
    estimate_id   VARCHAR(36) NOT NULL,
    estimate_type ENUM('maintenance','install') NOT NULL,
    payload       JSON        NOT NULL,
    submitted_by  VARCHAR(36) NOT NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_intake_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id) ON DELETE CASCADE,
    INDEX idx_intake_estimate (estimate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS intake_attachments (
    id                   VARCHAR(36)  NOT NULL,
    intake_submission_id VARCHAR(36)  NOT NULL,
    file_name            VARCHAR(255) NOT NULL,
    content_type         VARCHAR(100) NOT NULL,
    size_bytes           BIGINT       NOT NULL DEFAULT 0,
    url                  TEXT         NULL,
    kind                 ENUM('property_map','rfp','other') NOT NULL DEFAULT 'other',
    uploaded_by          VARCHAR(36)  NULL,
    status               ENUM('pending','stored','failed') NOT NULL DEFAULT 'pending',
    object_key           VARCHAR(512) NULL,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_attachments_intake
        FOREIGN KEY (intake_submission_id) REFERENCES intake_submissions (id) ON DELETE CASCADE,
    INDEX idx_attachments_intake (intake_submission_id),
    INDEX idx_attachments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.12 estimate_adjustments --------------------------------------------------
CREATE TABLE IF NOT EXISTS estimate_adjustments (
    id          VARCHAR(36)   NOT NULL,
    estimate_id VARCHAR(36)   NOT NULL,
    actor       VARCHAR(36)   NOT NULL,
    field       ENUM('complexity','margin') NOT NULL,
    from_value  DECIMAL(12,4) NOT NULL,
    to_value    DECIMAL(12,4) NOT NULL,
    created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_adjustments_estimate
        FOREIGN KEY (estimate_id) REFERENCES estimates (id) ON DELETE CASCADE,
    INDEX idx_adjustments_estimate (estimate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- §3.13 margin_bands ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS margin_bands (
    id       VARCHAR(36)  NOT NULL,
    name     VARCHAR(50)  NOT NULL DEFAULT 'default',
    good_min DECIMAL(6,4) NOT NULL,
    ok_min   DECIMAL(6,4) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_margin_bands_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Config seeds.
-- ---------------------------------------------------------------------------

INSERT INTO approval_tiers (id, role_key, label, min_value_cents, max_value_cents, tier_order, estimate_type) VALUES
    ('tier-maint-bm',  'branch_manager',    'Branch Manager',    0,           10000000,  1, 'maintenance'),
    ('tier-maint-rd',  'regional_director', 'Regional Director', 10000000,    25000000,  2, 'maintenance'),
    ('tier-maint-bp',  'bp',                'Business Partner',  25000000,    100000000, 3, 'maintenance'),
    ('tier-maint-coo', 'coo',               'COO',               100000000,   NULL,      4, 'maintenance')
ON DUPLICATE KEY UPDATE label = VALUES(label);

INSERT INTO margin_bands (id, name, good_min, ok_min) VALUES
    ('mb-default', 'default', 0.2000, 0.1200)
ON DUPLICATE KEY UPDATE good_min = VALUES(good_min), ok_min = VALUES(ok_min);

INSERT INTO itb_scopes (id, scope_key, label, scope_group, sort_order) VALUES
    ('scope-landscape',   'landscape',   'Landscape',           'estimating',   1),
    ('scope-irrigation',  'irrigation',  'Irrigation',          'estimating',   2),
    ('scope-trees',       'trees',       'Trees',               'estimating',   3),
    ('scope-sod',         'sod',         'Sod',                 'estimating',   4),
    ('scope-maintenance', 'maintenance', 'Maintenance',         'outside_dept', 5),
    ('scope-arbor',       'arbor',       'Arbor Care',          'outside_dept', 6),
    ('scope-hardscape',   'hardscape',   'Hardscape',           'vendor_only',  7),
    ('scope-fencing',     'fencing',     'Fencing',             'vendor_only',  8),
    ('scope-lighting',    'lighting',    'Landscape Lighting',  'vendor_only',  9)
ON DUPLICATE KEY UPDATE label = VALUES(label);

INSERT INTO material_calcs (id, material_key, label, compute_type, factors, unit_sell_cents, unit_cost_cents, uom, volume_quote_threshold_sf) VALUES
    ('mc-edging',       'edging',       'Steel Edging',                'divPiece',  '{"pieceLengthFt": 16}',                                            3200,  1900,  'pcs',     NULL),
    ('mc-weed-barrier', 'weed_barrier', 'Weed Barrier Fabric',         'divRoll',   '{"rollSf": 300}',                                                  8900,  5400,  'rolls',   NULL),
    ('mc-aggregate',    'aggregate',    'Decorative Rock / Aggregate', 'aggregate', '{"sfPerTonAtDepthIn": {"2": 120, "3": 80}, "defaultDepthIn": 2}',  9800,  6200,  'tons',    44000),
    ('mc-sod',          'sod',          'Sod',                         'sod',       '{"palletSf": 450}',                                                28500, 19500, 'pallets', NULL),
    ('mc-mulch',        'mulch',        'Mulch',                       'mulch',     '{"defaultDepthIn": 2}',                                            6800,  4100,  'cy',      NULL),
    ('mc-fert',         'fert',         'Fertilizer',                  'fert',      '{"coverageSfPerBag": 5000}',                                       5200,  3300,  'bags',    NULL),
    ('mc-backfill',     'backfill',     'Backfill Soil',               'backfill',  '{"defaultDepthIn": 6, "compactionPct": 0.15}',                     5500,  3400,  'cy',      NULL),
    ('mc-root-barrier', 'root_barrier', 'Root Barrier',                'divPiece',  '{"pieceLengthFt": 24}',                                            14500, 9800,  'pcs',     NULL)
ON DUPLICATE KEY UPDATE label = VALUES(label);
