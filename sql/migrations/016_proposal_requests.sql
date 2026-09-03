-- ---------------------------------------------------------------------------
-- Migration 016 — Handoff 37, Slice 4: proposal_requests table
--
-- Persists every generated ProposalRequest so it can be reopened and re-edited
-- (no ephemeral-only state, per CLAUDE.md and §6 of the handoff).
--
-- JSON columns mirror the ProposalRequest TS type in
-- studio/src/types/proposal.ts (Amendment A / Slice 1b):
--   sections               — ProposalSectionKey[]
--   org_chart              — OrgChartInput
--   startup_plan           — StartupPlanInput
--   team_member_ids        — string[]
--   executive_team_member_ids — string[]
--   client_reference_ids   — string[]
--   portfolio_property_ids — string[]
--
-- Validation enforced at the API layer (not a DB constraint):
--   estimate_id must exist in estimates.id
--   estimate.lead_id must equal lead_id
--   estimate.status must be 'approved'
--
-- No FK constraints — logical references only (repo convention, mirrors
-- estimates.lead_id and estimates.property_id).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `proposal_requests` (
    `id`                        VARCHAR(36)   NOT NULL,
    -- Lead that owns this proposal (logical FK → leads.id).
    `lead_id`                   VARCHAR(36)   NOT NULL,
    -- Approved estimate this proposal is based on (logical FK → estimates.id).
    `estimate_id`               VARCHAR(36)   NOT NULL,
    -- CRM user who created the proposal (logical FK → users.id / crm_users.id).
    `created_by`                VARCHAR(36)   NOT NULL,
    -- Which optional proposal sections are included.
    -- Required sections are implicit; only the optional ones that are checked
    -- appear here (matches the ProposalRequest.sections TS field intent, but
    -- all selected section keys are stored for completeness).
    `sections`                  TEXT          NOT NULL
        COMMENT 'JSON: ProposalSectionKey[]',
    -- Org chart inputs (§3) — whether to include, who is picked, crew counts.
    `org_chart`                 TEXT          NOT NULL
        COMMENT 'JSON: OrgChartInput',
    -- 30-60-90 optional page free-text entries.
    `startup_plan`              TEXT          NOT NULL
        COMMENT 'JSON: StartupPlanInput',
    -- team_members.id picks for page 8 (Meet Our Team — branch roster).
    `team_member_ids`           TEXT          NOT NULL
        COMMENT 'JSON: string[]',
    -- team_members.id picks for the optional executive team page.
    `executive_team_member_ids` TEXT          NOT NULL
        COMMENT 'JSON: string[]',
    -- client_references.id picks for page 9.
    `client_reference_ids`      TEXT          NOT NULL
        COMMENT 'JSON: string[]',
    -- portfolio_properties.id picks for page 11.
    `portfolio_property_ids`    TEXT          NOT NULL
        COMMENT 'JSON: string[]',
    -- User who signs the intro letter and thank-you pages.
    `signer_user_id`            VARCHAR(36)   NOT NULL,
    `created_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                              ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX idx_proposal_requests_lead     (`lead_id`),
    INDEX idx_proposal_requests_estimate (`estimate_id`),
    INDEX idx_proposal_requests_created  (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
