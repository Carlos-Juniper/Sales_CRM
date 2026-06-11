CREATE TABLE IF NOT EXISTS `juniper`.`crm_users` (
    `id`              VARCHAR(36)  NOT NULL,
    `name`            VARCHAR(255) NOT NULL,
    `email`           VARCHAR(255) NOT NULL,
    `role`            VARCHAR(50)  NOT NULL,
    `branch_id`       VARCHAR(100) NOT NULL,
    `avatar_initials` VARCHAR(5)   NOT NULL,
    `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
