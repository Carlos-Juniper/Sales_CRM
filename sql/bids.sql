CREATE TABLE IF NOT EXISTS `juniper`.`bids` (
    `id`              VARCHAR(36)   NOT NULL,
    `lead_id`         VARCHAR(36)   NOT NULL,
    `status`          VARCHAR(30)   NOT NULL DEFAULT 'pending',
    `estimated_value` DECIMAL(15,2) NOT NULL,
    `submitted_at`    DATETIME      DEFAULT NULL,
    `notes`           TEXT          DEFAULT NULL,
    `title`           VARCHAR(255)  DEFAULT NULL,
    `agency`          VARCHAR(255)  DEFAULT NULL,
    `branch_id`       VARCHAR(100)  DEFAULT NULL,
    `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_bids_lead`
        FOREIGN KEY (`lead_id`) REFERENCES `juniper`.`leads` (`id`) ON DELETE CASCADE,
    INDEX `idx_bids_lead_id` (`lead_id`),
    INDEX `idx_bids_status`  (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
