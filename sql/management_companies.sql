CREATE TABLE IF NOT EXISTS `juniper`.`management_companies` (
    `id`               VARCHAR(36)   NOT NULL,
    `name`             VARCHAR(255)  NOT NULL,
    `mailing_address`  VARCHAR(255)  DEFAULT NULL,
    `mailing_city`     VARCHAR(100)  DEFAULT NULL,
    `mailing_state`    CHAR(2)       DEFAULT NULL,
    `mailing_zip`      VARCHAR(20)   DEFAULT NULL,
    `phone`            VARCHAR(50)   DEFAULT NULL,
    `website`          VARCHAR(500)  DEFAULT NULL,
    `maps_place_id`    VARCHAR(255)  DEFAULT NULL,
    `contact_email`    VARCHAR(255)  DEFAULT NULL,
    `last_enriched_at` DATETIME      DEFAULT NULL,
    `created_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_mgmt_name_city` (`name`(191), `mailing_city`(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
