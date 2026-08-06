CREATE TABLE IF NOT EXISTS `crm`.`scraper_runs` (
    `id`             VARCHAR(36)  NOT NULL,
    `source`         VARCHAR(50)  NOT NULL,
    `started_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `completed_at`   DATETIME     DEFAULT NULL,
    `leads_found`    INT          DEFAULT 0,
    `leads_new`      INT          DEFAULT 0,
    `leads_skipped`  INT          DEFAULT 0,
    `errors`         INT          DEFAULT 0,
    `error_messages` JSON         DEFAULT NULL,
    `run_status`     VARCHAR(20)  DEFAULT 'running',
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
