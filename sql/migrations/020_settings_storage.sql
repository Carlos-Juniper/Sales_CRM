-- ---------------------------------------------------------------------------
-- Migration 020 — settings storage (Handoff 38, Slice 2).
--
-- Gives the Settings page somewhere to write. Every value created here is one
-- that is hardcoded in two places today (a Python constant and a TypeScript
-- constant), which is §5.4's "defined twice" defect: the discrepancy threshold
-- lives at api/estimating.py:436 AND studio/src/lib/estimating/config.ts.
-- The seeds below are those exact current values, so applying this migration
-- changes no behaviour — it only moves the source of truth.
--
-- Depends on 019 (branches.is_operating_branch, used by the crew-rate seed).
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so run once and only once.
-- Applied by scripts/migrate.py (detect_020 keys on estimates.crew_rate_cents_per_hour,
-- which the last statement in this file adds).
-- ---------------------------------------------------------------------------

-- ── 1. company_settings ─────────────────────────────────────────────────────
-- Typed columns, not a key/value blob: every one of these has a distinct type
-- and a distinct validation range, and a KV table pushes both into application
-- code where nothing enforces them.
--
-- Single row, enforced by CHECK rather than by convention. A second row here
-- would not error anywhere — reads would just silently pick one.
CREATE TABLE IF NOT EXISTS company_settings (
    id                             TINYINT       NOT NULL DEFAULT 1,
    sla_return_window_days         INT           NOT NULL,
    sla_at_risk_threshold_days     INT           NOT NULL,
    discrepancy_threshold_pct      DECIMAL(6,4)  NOT NULL,
    default_target_margin          DECIMAL(6,4)  NOT NULL,
    default_win_probability        DECIMAL(4,2)  NOT NULL,
    default_priority               VARCHAR(20)   NOT NULL,
    default_notify_bm_rd_on_return TINYINT(1)    NOT NULL,
    updated_at                     DATETIME      NOT NULL
        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT ck_company_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Current hardcoded values, verbatim:
--   14   studio/src/lib/estimating/sla.ts        SLA_CONFIG.returnWindowDays
--    4   studio/src/lib/estimating/sla.ts        SLA_CONFIG.atRiskThresholdDays
--   0.10 api/estimating.py:436                   DISCREPANCY_DEFAULT_THRESHOLD
--   0.22 api/estimating.py  create_estimate      targetMargin default
--   0.20 api/estimating.py  create_estimate      winProbability default
-- 'medium' / 1                                   priority, notifyBmRdOnReturn defaults
INSERT INTO company_settings
    (id, sla_return_window_days, sla_at_risk_threshold_days, discrepancy_threshold_pct,
     default_target_margin, default_win_probability, default_priority,
     default_notify_bm_rd_on_return)
VALUES (1, 14, 4, 0.1000, 0.2200, 0.20, 'medium', 1)
ON DUPLICATE KEY UPDATE id = id;

-- ── 2. branch_settings ──────────────────────────────────────────────────────
-- crew_rate_cents_per_hour is NOT NULL and there is no fallback anywhere: a
-- branch with no row must show "no crew rate configured", never a number that
-- looks real. That is the whole point of the column (Handoff 38 §6) — the
-- 18_000 currently sitting in MAINT_LOADED_CREW_RATE_CENTS_PER_HOUR is invented
-- demo data, and a fallback would keep it invisible.
CREATE TABLE IF NOT EXISTS branch_settings (
    aspire_branch_id         INT      NOT NULL,
    crew_rate_cents_per_hour BIGINT   NOT NULL,
    updated_at               DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (aspire_branch_id),
    CONSTRAINT fk_branch_settings_branch
        FOREIGN KEY (aspire_branch_id) REFERENCES branches (aspire_branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- $180/hr for every real operating branch, per Amendment B; branch managers
-- move theirs from there. Seeded only for active + operating branches — the
-- "*** PICK A BRANCH ***" and "DO NOT USE" rows must stay rateless so that
-- anything that somehow routes an estimate to one fails loudly.
INSERT INTO branch_settings (aspire_branch_id, crew_rate_cents_per_hour)
SELECT aspire_branch_id, 18000
  FROM branches
 WHERE active = 1
   AND is_operating_branch = 1
ON DUPLICATE KEY UPDATE crew_rate_cents_per_hour = branch_settings.crew_rate_cents_per_hour;

-- ── 3. config_audit ─────────────────────────────────────────────────────────
-- One table for both scopes. Settings writes are low-volume and always
-- answering the same question ("who changed this, from what, when"), so two
-- tables would only mean two queries to answer it.
--
-- scope_id is VARCHAR(50), not INT: it holds an aspire_branch_id today and is
-- NULL for company scope, but the scope set grows (user, region) and a widened
-- ENUM against an INT column would have nowhere to put a UUID.
CREATE TABLE IF NOT EXISTS config_audit (
    id          VARCHAR(36)                  NOT NULL,
    scope_type  ENUM('company','branch')     NOT NULL,
    scope_id    VARCHAR(50)                  NULL DEFAULT NULL,
    setting_key VARCHAR(100)                 NOT NULL,
    from_value  TEXT                         NULL DEFAULT NULL,
    to_value    TEXT                         NULL DEFAULT NULL,
    actor       VARCHAR(255)                 NOT NULL,
    created_at  DATETIME                     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_config_audit_scope (scope_type, scope_id, created_at),
    INDEX idx_config_audit_key (setting_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. material_calcs.aspire_branch_id ──────────────────────────────────────
-- NULL = company-wide, the house convention from Handoff 38 §2.3. Branch rows
-- override the company row for the same material_key.
--
-- The existing UNIQUE KEY on material_key alone forbids that override, so it is
-- replaced. The generated column is not decoration: MySQL treats NULLs as
-- distinct in a UNIQUE index, so UNIQUE (material_key, aspire_branch_id) would
-- happily accept two company-wide rows for one material and let the formula
-- engine pick whichever it read first. Folding NULL to 0 makes the constraint
-- actually hold, while keeping NULL as the value the application reads.
-- Two statements, not one: a generated column cannot reference a column added
-- by the same ALTER.
ALTER TABLE material_calcs
    ADD COLUMN aspire_branch_id INT NULL DEFAULT NULL AFTER material_key,
    ADD INDEX idx_material_calcs_branch (aspire_branch_id),
    ADD CONSTRAINT fk_material_calcs_branch
        FOREIGN KEY (aspire_branch_id) REFERENCES branches (aspire_branch_id);

ALTER TABLE material_calcs
    ADD COLUMN branch_scope_key INT
        GENERATED ALWAYS AS (COALESCE(aspire_branch_id, 0)) STORED,
    DROP INDEX uq_material_key,
    ADD UNIQUE KEY uq_material_key_scope (material_key, branch_scope_key);

-- ── 5. estimates.crew_rate_cents_per_hour ───────────────────────────────────
-- The rate in force when the estimate was frozen, not the branch's rate now.
-- Without it, a branch manager raising the crew rate silently restates the
-- margin on every estimate already sitting in review or approved.
--
-- Written on entry to review / pending_approval / approved, cleared on
-- in_progress, preserved through handed_back / won / lost (§6).
--
-- Last statement in the file on purpose: detect_020 keys on this column, so a
-- run that dies partway leaves detection FALSE and the migration re-runnable.
-- Everything above is either CREATE TABLE IF NOT EXISTS or an idempotent
-- INSERT; only §4 and this ALTER are one-shot, and §4 immediately precedes it.
ALTER TABLE estimates
    ADD COLUMN crew_rate_cents_per_hour BIGINT NULL DEFAULT NULL AFTER target_margin;
