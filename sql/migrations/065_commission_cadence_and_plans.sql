-- ---------------------------------------------------------------------------
-- Migration 065 — commission payout installments and standard plan rules.
--
-- Payout cadence is universal (not a plan setting): each commission is paid
-- in two equal installments, one quarter apart, lagging the close quarter.
-- Close date is commissions.created_at evaluated in America/New_York.
-- Plan tables hold rates only. No per-user plan rows are inserted here;
-- individual plans (including any regional salesperson or VP of Sales) stay
-- unassigned, and existing commission_rates rows are not modified.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, information_schema-guarded ALTERs,
-- INSERT IGNORE seeds, and a NOT EXISTS backfill. detect_065 keys on the
-- tables, the commissions snapshot columns, the unique indexes, the standard
-- maintenance / new-client / enhancement seed rows, and a complete installment
-- backfill (every commission has installment 1).
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

INSERT IGNORE INTO commission_plans (plan_key, name, description, active) VALUES (
  'standard',
  'Standard Sales Commission',
  'Default company plan. Maintenance: 3 percent of first-year annual contract value. Construction: marginal calendar-year tiers for new clients (0.4 percent to $1M, 0.8 percent to $2M, 1.2 percent above) and existing clients (0 percent on the first $3M, 0.4 percent above). Enhancement rules are stored for configuration and are not calculated until gross-profit data exists. Payout timing is not part of the plan.',
  1
);

-- Rates are data. tier_max_cents is exclusive. Dollars converted to cents:
-- $1M = 100000000, $2M = 200000000, $3M = 300000000.
-- Enhancement dollar gates are "over" the threshold, so the min is one cent past it.
INSERT IGNORE INTO commission_plan_rules
  (id, plan_key, estimate_type, client_type, tier_min_cents, tier_max_cents, rate, basis, effective_date)
VALUES
  ('rule-standard-maint', 'standard', 'maintenance', NULL, 0, NULL, 0.03000, 'first_year_revenue', '2024-03-13'),
  ('rule-standard-install-new-0', 'standard', 'install', 'new', 0, 100000000, 0.00400, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-install-new-1m', 'standard', 'install', 'new', 100000000, 200000000, 0.00800, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-install-new-2m', 'standard', 'install', 'new', 200000000, NULL, 0.01200, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-install-existing-0', 'standard', 'install', 'existing', 0, 300000000, 0.00000, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-install-existing-3m', 'standard', 'install', 'existing', 300000000, NULL, 0.00400, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-enh-new-gp55', 'standard', 'enhancement', 'new', 0, NULL, 0.03000, 'enhancement_collected_gp_gte_55', '2024-03-08'),
  ('rule-standard-enh-gp50-over-5k', 'standard', 'enhancement', NULL, 500001, NULL, 0.01500, 'enhancement_collected_gp_gte_50', '2024-03-08'),
  ('rule-standard-enh-gp45-over-10k', 'standard', 'enhancement', NULL, 1000001, NULL, 0.01500, 'enhancement_collected_gp_gte_45', '2024-03-08');

-- One row per installment. Paid commissions mark both installments paid.
-- Cancelled commissions mark both cancelled. Everyone else stays scheduled;
-- due vs upcoming is derived at read time.
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
) src
WHERE NOT EXISTS (
  SELECT 1 FROM commission_installments existing
  WHERE existing.commission_id = src.id
    AND existing.installment_number = src.installment_number
);
