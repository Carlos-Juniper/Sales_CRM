-- Migration 017 — Handoff 39: proposal_renders table
--
-- Stores every server-side PDF render result for a ProposalRequest.
-- Object key: proposal/generated/{proposal_id}/v{version}.pdf
-- Status: 'complete' | 'pending' | 'failed'
--
-- No FK constraints — logical references only (repo convention).

CREATE TABLE IF NOT EXISTS `proposal_renders` (
    `id`            VARCHAR(36)   NOT NULL,
    `proposal_id`   VARCHAR(36)   NOT NULL,
    `version`       INT           NOT NULL,
    `object_key`    VARCHAR(512)  NOT NULL,
    `page_count`    INT           NULL,
    `status`        VARCHAR(16)   NOT NULL COMMENT 'complete | pending | failed',
    `error_message` TEXT          NULL,
    `rendered_by`   VARCHAR(36)   NOT NULL,
    `duration_ms`   INT           NULL,
    `created_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_proposal_version` (`proposal_id`, `version`),
    KEY `idx_proposal` (`proposal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
