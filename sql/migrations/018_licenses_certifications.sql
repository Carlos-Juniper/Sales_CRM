-- Migration 018 — Handoff 40: licenses & certifications
--
-- Backs the licenses/certifications page of the generated proposal.
-- Shape deliberately mirrors crm.insurance_certificates (migration 014) so the
-- Settings handoff can manage both through one admin surface.
--
-- aspire_branch_id NULL means company-wide; expiry_date NULL means the credential
-- does not expire. object_key is the GCS scan and may be NULL — the proposal page
-- renders the row either way.
--
-- No seed rows: every credential currently on file is expired, and the page is
-- client-facing. It degrades to a prose "available on request" line while empty.
--
-- No FK constraints — logical references only (repo convention).

CREATE TABLE IF NOT EXISTS `licenses_certifications` (
    `id`               VARCHAR(36)  NOT NULL,
    `kind`             ENUM('license','certification') NOT NULL,
    `name`             VARCHAR(200) NOT NULL,
    `issuing_body`     VARCHAR(200) NULL DEFAULT NULL,
    `identifier`       VARCHAR(100) NULL DEFAULT NULL,   -- license number
    `holder_name`      VARCHAR(150) NULL DEFAULT NULL,
    `aspire_branch_id` INT          NULL DEFAULT NULL,   -- NULL = company-wide
    `issued_date`      DATE         NULL DEFAULT NULL,
    `expiry_date`      DATE         NULL DEFAULT NULL,   -- NULL = non-expiring
    `object_key`       VARCHAR(500) NULL DEFAULT NULL,   -- GCS scan
    `active`           TINYINT(1)   NOT NULL DEFAULT 1,
    `sort_order`       INT          NOT NULL DEFAULT 0,
    `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                         ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_lc_branch` (`aspire_branch_id`),
    KEY `idx_lc_expiry` (`expiry_date`),
    KEY `idx_lc_active` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
