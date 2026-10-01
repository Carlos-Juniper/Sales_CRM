-- ---------------------------------------------------------------------------
-- Migration 076 — service_kit_rates + branch_crew_rate_history
--
-- Handoff 54 §4. Two append-only rate-history tables:
--
--   service_kit_rates          Per-kit pricing snapshots. aspire_branch_id=NULL
--                              means company-wide; a non-NULL id is a branch
--                              override. The newest row for a given
--                              (service_kit_id, aspire_branch_id) pair wins.
--                              Never UPDATE or DELETE — append only.
--
--   branch_crew_rate_history   Crew-rate change ledger. One row per change to
--                              branch_settings.crew_rate_cents_per_hour, so the
--                              full timeline is queryable. Never UPDATE or DELETE.
--
-- No FK constraints: Cloud SQL migration user has limited perms.
-- No is_current flag, no generated columns, no triggers, no unique keys.
-- Both tables use CREATE TABLE IF NOT EXISTS for idempotency.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm.service_kit_rates (
    id                VARCHAR(36)     NOT NULL,
    service_kit_id    VARCHAR(50)     NOT NULL,
    aspire_branch_id  INT             NULL,
    production_rate   DECIMAL(14,4)   NULL,
    unit_cost_cents   BIGINT          NULL,
    target_gm         DECIMAL(6,4)    NULL,
    effective_from    DATETIME        NOT NULL,
    entered_by        VARCHAR(36)     NOT NULL,
    note              TEXT            NULL,
    created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rate_lookup (service_kit_id, aspire_branch_id, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm.branch_crew_rate_history (
    id                       VARCHAR(36)  NOT NULL,
    aspire_branch_id         INT          NOT NULL,
    crew_rate_cents_per_hour BIGINT       NOT NULL,
    effective_from           DATETIME     NOT NULL,
    entered_by               VARCHAR(36)  NOT NULL,
    note                     TEXT         NULL,
    created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_crew_rate_lookup (aspire_branch_id, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
