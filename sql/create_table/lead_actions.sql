CREATE TABLE IF NOT EXISTS `crm`.`lead_actions` (
    `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    `lead_id`      VARCHAR(36)   NOT NULL,
    `action_type`  VARCHAR(50)   NOT NULL,
    `prev_status`  VARCHAR(30)   DEFAULT NULL,
    `new_status`   VARCHAR(30)   DEFAULT NULL,
    `detail`       TEXT          DEFAULT NULL,
    `performed_by` VARCHAR(255)  DEFAULT NULL,
    `performed_at` DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_lead_actions_lead`
        FOREIGN KEY (`lead_id`) REFERENCES `crm`.`leads` (`id`) ON DELETE CASCADE,
    INDEX `idx_lead_id`      (`lead_id`),
    INDEX `idx_performed_at` (`performed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
