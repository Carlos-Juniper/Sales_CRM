-- ---------------------------------------------------------------------------
-- Migration 065 — commission payout installments and standard plan rules.
--
-- Payout cadence is data on commission_plan_rules.payout_schedule:
--   maintenance_split_lagged — two installments, half at the start of the
--     next quarter and half at the start of the quarter after that
--   quarter_end — one installment on the last day of the close quarter
--     (install / construction)
--   month_after_quarter_end — one installment on the first day of the month
--     after the close quarter (enhancement)
-- Close date is commissions.created_at evaluated in America/New_York.
-- Install and enhancement dates use that won date. The CRM has no billing or
-- collections dates, so this is an approximation until that data exists.
-- No per-user plan rows are inserted here. Individual plans stay unassigned,
-- and existing commission_rates rows are not modified. A legacy rate still
-- controls the amount. Timing follows the standard rule for the estimate type.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, information_schema-guarded ALTERs,
-- INSERT ... ON DUPLICATE KEY UPDATE for the standard plan and its rules,
-- NOT EXISTS backfill, a corrective DELETE of installment 2 on non-maintenance
-- commissions, and an UPDATE of installment 1 to the schedule date and the
-- full amount. detect_065 keys on the tables, payout_schedule, the commissions
-- snapshot columns, the unique indexes, the three seeded schedules, and a
-- complete installment backfill (every commission has installment 1).
--
-- Backfill treats created_at as UTC when converting to Eastern, matching the
-- application (naive timestamps are UTC). If the named time zone is not
-- loaded, CONVERT_TZ returns NULL and the session datetime is used as-is.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS commission_plans (
  plan_key VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commission_plan_rules (
  id VARCHAR(64) NOT NULL,
  plan_key VARCHAR(64) NOT NULL,
  estimate_type VARCHAR(32) NOT NULL,
  client_type VARCHAR(32) NULL,
  tier_min_cents BIGINT NOT NULL DEFAULT 0,
  tier_max_cents BIGINT NULL,
  rate DECIMAL(6,5) NOT NULL,
  basis VARCHAR(80) NOT NULL,
  payout_schedule VARCHAR(40) NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_commission_plan_rules_plan
    FOREIGN KEY (plan_key) REFERENCES commission_plans (plan_key),
  INDEX idx_plan_rules_lookup (plan_key, estimate_type, effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_commission_plans (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL,
  plan_key VARCHAR(64) NOT NULL,
  effective_date DATE NOT NULL,
  expires_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_commission_plans_user_effective (user_id, effective_date),
  CONSTRAINT fk_user_commission_plans_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_user_commission_plans_plan
    FOREIGN KEY (plan_key) REFERENCES commission_plans (plan_key),
  CONSTRAINT chk_user_commission_plan_dates
    CHECK (expires_date IS NULL OR expires_date > effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commission_installments (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  commission_id VARCHAR(36) NOT NULL,
  installment_number TINYINT NOT NULL,
  payout_period_label VARCHAR(32) NOT NULL,
  payout_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL,
  status ENUM('scheduled', 'paid', 'cancelled') NOT NULL DEFAULT 'scheduled',
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_commission_installment (commission_id, installment_number),
  CONSTRAINT fk_commission_installments_commission
    FOREIGN KEY (commission_id) REFERENCES commissions (id),
  CONSTRAINT chk_installment_number CHECK (installment_number IN (1, 2)),
  CONSTRAINT chk_installment_amount CHECK (amount_cents >= 0),
  INDEX idx_installments_payout_date (payout_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @add_plan_key = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commissions'
       AND column_name = 'plan_key') > 0,
    'SELECT 1',
    'ALTER TABLE `commissions` ADD COLUMN `plan_key` VARCHAR(64) NULL'
);
PREPARE stmt_add_plan_key FROM @add_plan_key;
EXECUTE stmt_add_plan_key;
DEALLOCATE PREPARE stmt_add_plan_key;

SET @add_client_type = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commissions'
       AND column_name = 'client_type') > 0,
    'SELECT 1',
    'ALTER TABLE `commissions` ADD COLUMN `client_type` VARCHAR(32) NULL'
);
PREPARE stmt_add_client_type FROM @add_client_type;
EXECUTE stmt_add_client_type;
DEALLOCATE PREPARE stmt_add_client_type;

SET @add_user_plan_unique = IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'user_commission_plans'
       AND index_name = 'uq_user_commission_plans_user_effective') > 0,
    'SELECT 1',
    'ALTER TABLE `user_commission_plans` ADD CONSTRAINT uq_user_commission_plans_user_effective UNIQUE KEY (user_id, effective_date)'
);
PREPARE stmt_add_user_plan_unique FROM @add_user_plan_unique;
EXECUTE stmt_add_user_plan_unique;
DEALLOCATE PREPARE stmt_add_user_plan_unique;

SET @add_installment_unique = IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND index_name = 'uq_commission_installment') > 0,
    'SELECT 1',
    'ALTER TABLE `commission_installments` ADD CONSTRAINT uq_commission_installment UNIQUE KEY (commission_id, installment_number)'
);
PREPARE stmt_add_installment_unique FROM @add_installment_unique;
EXECUTE stmt_add_installment_unique;
DEALLOCATE PREPARE stmt_add_installment_unique;

SET @add_payout_schedule = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_plan_rules'
       AND column_name = 'payout_schedule') > 0,
    'SELECT 1',
    'ALTER TABLE `commission_plan_rules` ADD COLUMN `payout_schedule` VARCHAR(40) NULL'
);
PREPARE stmt_add_payout_schedule FROM @add_payout_schedule;
EXECUTE stmt_add_payout_schedule;
DEALLOCATE PREPARE stmt_add_payout_schedule;

INSERT INTO commission_plans (plan_key, name, description, active) VALUES (
  'standard',
  'Standard Sales Commission',
  'Default company plan. Maintenance: 3 percent of first-year annual contract value, paid maintenance_split_lagged. Construction: marginal calendar-year tiers for new clients (0.4 percent to $1M, 0.8 percent to $2M, 1.2 percent above) and existing clients (0 percent on the first $3M, 0.4 percent above), paid quarter_end. Enhancement rules are stored for configuration and are not calculated until gross-profit data exists, paid month_after_quarter_end. Install and enhancement dates use the won quarter until billing and collections data exists.',
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description);

-- Rates are data. tier_max_cents is exclusive. Dollars converted to cents:
-- $1M = 100000000, $2M = 200000000, $3M = 300000000.
-- Enhancement dollar gates are "over" the threshold, so the min is one cent past it.
-- Re-runs fill payout_schedule without rewriting rates.
INSERT INTO commission_plan_rules
  (id, plan_key, estimate_type, client_type, tier_min_cents, tier_max_cents, rate, basis, payout_schedule, effective_date)
VALUES
  ('rule-standard-maint', 'standard', 'maintenance', NULL, 0, NULL, 0.03000, 'first_year_revenue', 'maintenance_split_lagged', '2024-03-13'),
  ('rule-standard-install-new-0', 'standard', 'install', 'new', 0, 100000000, 0.00400, 'calendar_year_cumulative_revenue', 'quarter_end', '2024-03-13'),
  ('rule-standard-install-new-1m', 'standard', 'install', 'new', 100000000, 200000000, 0.00800, 'calendar_year_cumulative_revenue', 'quarter_end', '2024-03-13'),
  ('rule-standard-install-new-2m', 'standard', 'install', 'new', 200000000, NULL, 0.01200, 'calendar_year_cumulative_revenue', 'quarter_end', '2024-03-13'),
  ('rule-standard-install-existing-0', 'standard', 'install', 'existing', 0, 300000000, 0.00000, 'calendar_year_cumulative_revenue', 'quarter_end', '2024-03-13'),
  ('rule-standard-install-existing-3m', 'standard', 'install', 'existing', 300000000, NULL, 0.00400, 'calendar_year_cumulative_revenue', 'quarter_end', '2024-03-13'),
  ('rule-standard-enh-new-gp55', 'standard', 'enhancement', 'new', 0, NULL, 0.03000, 'enhancement_collected_gp_gte_55', 'month_after_quarter_end', '2024-03-08'),
  ('rule-standard-enh-gp50-over-5k', 'standard', 'enhancement', NULL, 500001, NULL, 0.01500, 'enhancement_collected_gp_gte_50', 'month_after_quarter_end', '2024-03-08'),
  ('rule-standard-enh-gp45-over-10k', 'standard', 'enhancement', NULL, 1000001, NULL, 0.01500, 'enhancement_collected_gp_gte_45', 'month_after_quarter_end', '2024-03-08')
ON DUPLICATE KEY UPDATE
  payout_schedule = VALUES(payout_schedule);

-- Maintenance: two lagged installments. Paid commissions mark both paid.
-- Cancelled commissions mark both cancelled. Everyone else stays scheduled.
INSERT IGNORE INTO commission_installments
  (id, commission_id, installment_number, payout_period_label, payout_date, amount_cents, status, paid_at)
SELECT
  UUID(),
  src.id,
  src.installment_number,
  CONCAT(
    ELT(MONTH(src.payout_date),
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'),
    ' ',
    YEAR(src.payout_date)
  ),
  src.payout_date,
  src.amount_cents,
  src.installment_status,
  src.paid_at
FROM (
  SELECT
    c.id,
    n.installment_number,
    CASE
      WHEN n.installment_number = 1 THEN c.commission_amount_cents DIV 2
      ELSE c.commission_amount_cents - (c.commission_amount_cents DIV 2)
    END AS amount_cents,
    CASE
      WHEN QUARTER(d.close_date) = 1 AND n.installment_number = 1 THEN DATE(CONCAT(YEAR(d.close_date), '-04-01'))
      WHEN QUARTER(d.close_date) = 1 AND n.installment_number = 2 THEN DATE(CONCAT(YEAR(d.close_date), '-07-01'))
      WHEN QUARTER(d.close_date) = 2 AND n.installment_number = 1 THEN DATE(CONCAT(YEAR(d.close_date), '-07-01'))
      WHEN QUARTER(d.close_date) = 2 AND n.installment_number = 2 THEN DATE(CONCAT(YEAR(d.close_date), '-10-01'))
      WHEN QUARTER(d.close_date) = 3 AND n.installment_number = 1 THEN DATE(CONCAT(YEAR(d.close_date), '-10-01'))
      WHEN QUARTER(d.close_date) = 3 AND n.installment_number = 2 THEN DATE(CONCAT(YEAR(d.close_date) + 1, '-01-01'))
      WHEN QUARTER(d.close_date) = 4 AND n.installment_number = 1 THEN DATE(CONCAT(YEAR(d.close_date) + 1, '-01-01'))
      ELSE DATE(CONCAT(YEAR(d.close_date) + 1, '-04-01'))
    END AS payout_date,
    CASE
      WHEN c.status = 'paid' THEN 'paid'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'scheduled'
    END AS installment_status,
    CASE WHEN c.status = 'paid' THEN c.paid_at ELSE NULL END AS paid_at
  FROM commissions c
  LEFT JOIN estimates e ON e.id = c.estimate_id
  JOIN (
    SELECT
      id,
      DATE(COALESCE(CONVERT_TZ(created_at, '+00:00', 'America/New_York'), created_at)) AS close_date
    FROM commissions
  ) d ON d.id = c.id
  JOIN (
    SELECT 1 AS installment_number
    UNION ALL
    SELECT 2
  ) n
  WHERE COALESCE(e.estimate_type, '') = 'maintenance'
) src
WHERE NOT EXISTS (
  SELECT 1 FROM commission_installments existing
  WHERE existing.commission_id = src.id
    AND existing.installment_number = src.installment_number
);

-- Install, enhancement, and any other non-maintenance type: one installment
-- for the full amount. Enhancement pays the month after the quarter.
-- Everything else pays on the last day of the close quarter.
INSERT IGNORE INTO commission_installments
  (id, commission_id, installment_number, payout_period_label, payout_date, amount_cents, status, paid_at)
SELECT
  UUID(),
  src.id,
  1,
  CONCAT(
    ELT(MONTH(src.payout_date),
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'),
    ' ',
    YEAR(src.payout_date)
  ),
  src.payout_date,
  src.amount_cents,
  src.installment_status,
  src.paid_at
FROM (
  SELECT
    c.id,
    c.commission_amount_cents AS amount_cents,
    CASE
      WHEN COALESCE(e.estimate_type, '') = 'enhancement' AND QUARTER(d.close_date) = 1 THEN DATE(CONCAT(YEAR(d.close_date), '-04-01'))
      WHEN COALESCE(e.estimate_type, '') = 'enhancement' AND QUARTER(d.close_date) = 2 THEN DATE(CONCAT(YEAR(d.close_date), '-07-01'))
      WHEN COALESCE(e.estimate_type, '') = 'enhancement' AND QUARTER(d.close_date) = 3 THEN DATE(CONCAT(YEAR(d.close_date), '-10-01'))
      WHEN COALESCE(e.estimate_type, '') = 'enhancement' THEN DATE(CONCAT(YEAR(d.close_date) + 1, '-01-01'))
      WHEN QUARTER(d.close_date) = 1 THEN DATE(CONCAT(YEAR(d.close_date), '-03-31'))
      WHEN QUARTER(d.close_date) = 2 THEN DATE(CONCAT(YEAR(d.close_date), '-06-30'))
      WHEN QUARTER(d.close_date) = 3 THEN DATE(CONCAT(YEAR(d.close_date), '-09-30'))
      ELSE DATE(CONCAT(YEAR(d.close_date), '-12-31'))
    END AS payout_date,
    CASE
      WHEN c.status = 'paid' THEN 'paid'
      WHEN c.status = 'cancelled' THEN 'cancelled'
      ELSE 'scheduled'
    END AS installment_status,
    CASE WHEN c.status = 'paid' THEN c.paid_at ELSE NULL END AS paid_at
  FROM commissions c
  LEFT JOIN estimates e ON e.id = c.estimate_id
  JOIN (
    SELECT
      id,
      DATE(COALESCE(CONVERT_TZ(created_at, '+00:00', 'America/New_York'), created_at)) AS close_date
    FROM commissions
  ) d ON d.id = c.id
  WHERE COALESCE(e.estimate_type, '') <> 'maintenance'
) src
WHERE NOT EXISTS (
  SELECT 1 FROM commission_installments existing
  WHERE existing.commission_id = src.id
    AND existing.installment_number = 1
);

-- A previous draft of this migration wrote two lagged rows for every
-- commission. Drop the second row wherever the sale is not maintenance.
DELETE i
FROM commission_installments i
JOIN commissions c ON c.id = i.commission_id
LEFT JOIN estimates e ON e.id = c.estimate_id
WHERE i.installment_number = 2
  AND COALESCE(e.estimate_type, '') <> 'maintenance';

-- And put installment 1 on the schedule date for the full amount.
-- The date is computed in the joined subquery so the label can read it.
-- A SET clause cannot read a column assigned earlier in the same statement.
UPDATE commission_installments i
JOIN (
  SELECT
    c.id AS commission_id,
    c.commission_amount_cents,
    CASE
      WHEN COALESCE(e.estimate_type, '') = 'enhancement' AND QUARTER(d.close_date) = 1 THEN DATE(CONCAT(YEAR(d.close_date), '-04-01'))
      WHEN COALESCE(e.estimate_type, '') = 'enhancement' AND QUARTER(d.close_date) = 2 THEN DATE(CONCAT(YEAR(d.close_date), '-07-01'))
      WHEN COALESCE(e.estimate_type, '') = 'enhancement' AND QUARTER(d.close_date) = 3 THEN DATE(CONCAT(YEAR(d.close_date), '-10-01'))
      WHEN COALESCE(e.estimate_type, '') = 'enhancement' THEN DATE(CONCAT(YEAR(d.close_date) + 1, '-01-01'))
      WHEN QUARTER(d.close_date) = 1 THEN DATE(CONCAT(YEAR(d.close_date), '-03-31'))
      WHEN QUARTER(d.close_date) = 2 THEN DATE(CONCAT(YEAR(d.close_date), '-06-30'))
      WHEN QUARTER(d.close_date) = 3 THEN DATE(CONCAT(YEAR(d.close_date), '-09-30'))
      ELSE DATE(CONCAT(YEAR(d.close_date), '-12-31'))
    END AS payout_date
  FROM commissions c
  LEFT JOIN estimates e ON e.id = c.estimate_id
  JOIN (
    SELECT
      id,
      DATE(COALESCE(CONVERT_TZ(created_at, '+00:00', 'America/New_York'), created_at)) AS close_date
    FROM commissions
  ) d ON d.id = c.id
  WHERE COALESCE(e.estimate_type, '') <> 'maintenance'
) src ON src.commission_id = i.commission_id
SET
  i.amount_cents = src.commission_amount_cents,
  i.payout_date = src.payout_date,
  i.payout_period_label = CONCAT(
    ELT(MONTH(src.payout_date),
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'),
    ' ',
    YEAR(src.payout_date)
  )
WHERE i.installment_number = 1;
