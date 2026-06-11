CREATE TABLE IF NOT EXISTS `juniper`.`hoa_contact_information` (
    `id`                    BIGINT       NOT NULL AUTO_INCREMENT,
    `management_company_id` VARCHAR(36)  DEFAULT NULL,
    `hoa_property_id`       VARCHAR(36)  DEFAULT NULL,
    `email`                 VARCHAR(255) NOT NULL,
    `phone`                 VARCHAR(50)  DEFAULT NULL,
    `contact_name`          VARCHAR(255) DEFAULT NULL,
    `source`                VARCHAR(50)  NOT NULL DEFAULT 'website_scrape',
    `page_url`              VARCHAR(500) DEFAULT NULL,
    `created_at`            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_mgmt_email`     (`management_company_id`, `email`(191)),
    UNIQUE KEY `uq_property_email` (`hoa_property_id`, `email`(191)),
    INDEX `idx_hoa_contact_property` (`hoa_property_id`),
    INDEX `idx_hoa_contact_mgmt_co`  (`management_company_id`),
    CONSTRAINT `fk_hoa_contact_property`
        FOREIGN KEY (`hoa_property_id`) REFERENCES `juniper`.`hoa_properties` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
