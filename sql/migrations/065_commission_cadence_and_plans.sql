-- ---------------------------------------------------------------------------
-- Migration 065 — commission payout installments and standard plan rules.
--
-- Payout cadence is data on commission_plan_rules.payout_schedule:
--   maintenance_3_payment — three installments. Payment 1 is half of the
--     annual commission at the end of the quarter the contract starts in.
--     Payment 2 is the other half and waits on the 6th billing installment.
--     Payment 3 waits on additional revenue through the 12th installment.
--   construction_billing_quarterly — one row, pending billing and collections
--   enhancement_month_after_quarter — one row, pending billing and collections
-- commission_billing_events is an empty ledger for a later Aspire backfill.
-- This file does not insert billing rows and does not invent collection dates.
-- No per-user plan rows are inserted. commission_rates rows are not modified.
-- A legacy rate still controls the amount. Timing follows the estimate type.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, information_schema-guarded ALTERs,
-- INSERT ... ON DUPLICATE KEY UPDATE for the standard plan and its rules,
-- a guarded reshape of installment columns, and a rebuild of installment rows
-- into the plan-document shape. detect_065 keys on the tables (including
-- commission_billing_events), payout_schedule, contract_start_date, the
-- installment basis columns, the three seeded schedules, and a complete
-- installment-1 backfill. Re-running the installment rebuild after Aspire
-- billing has been written onto those rows would wipe that data. The detector
-- stops the runner once this migration is recorded.
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
  payout_period_label VARCHAR(32) NULL,
  payout_date DATE NULL,
  amount_cents BIGINT NULL,
  status ENUM('scheduled', 'paid', 'cancelled', 'pending_billing_data') NOT NULL DEFAULT 'scheduled',
  billing_installment_number INT NULL,
  collected_amount_cents BIGINT NULL,
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_commission_installment (commission_id, installment_number),
  CONSTRAINT fk_commission_installments_commission
    FOREIGN KEY (commission_id) REFERENCES commissions (id),
  CONSTRAINT chk_installment_number CHECK (installment_number IN (1, 2, 3)),
  CONSTRAINT chk_installment_amount CHECK (amount_cents IS NULL OR amount_cents >= 0),
  INDEX idx_installments_payout_date (payout_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Empty ledger. Aspire invoice and collection rows are backfilled later.
-- No seed rows.
CREATE TABLE IF NOT EXISTS commission_billing_events (
  id VARCHAR(36) NOT NULL DEFAULT (UUID()),
  estimate_id VARCHAR(36) NULL,
  commission_id VARCHAR(36) NULL,
  aspire_invoice_number VARCHAR(64) NULL,
  aspire_contract_id VARCHAR(64) NULL,
  aspire_opportunity_id VARCHAR(64) NULL,
  billing_installment_number INT NULL,
  invoice_date DATE NULL,
  amount_billed_cents BIGINT NULL,
  amount_collected_cents BIGINT NULL,
  collected_date DATE NULL,
  ar_aging_days INT NULL,
  gross_profit_percent DECIMAL(7,4) NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'aspire',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_billing_events_estimate (estimate_id),
  INDEX idx_billing_events_commission (commission_id),
  INDEX idx_billing_events_aspire_invoice (aspire_invoice_number),
  INDEX idx_billing_events_aspire_contract (aspire_contract_id),
  CONSTRAINT fk_billing_events_estimate
    FOREIGN KEY (estimate_id) REFERENCES estimates (id),
  CONSTRAINT fk_billing_events_commission
    FOREIGN KEY (commission_id) REFERENCES commissions (id)
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

SET @add_contract_start = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commissions'
       AND column_name = 'contract_start_date') > 0,
    'SELECT 1',
    'ALTER TABLE `commissions` ADD COLUMN `contract_start_date` DATE NULL'
);
PREPARE stmt_add_contract_start FROM @add_contract_start;
EXECUTE stmt_add_contract_start;
DEALLOCATE PREPARE stmt_add_contract_start;

SET @add_billing_inst = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND column_name = 'billing_installment_number') > 0,
    'SELECT 1',
    'ALTER TABLE `commission_installments` ADD COLUMN `billing_installment_number` INT NULL'
);
PREPARE stmt_add_billing_inst FROM @add_billing_inst;
EXECUTE stmt_add_billing_inst;
DEALLOCATE PREPARE stmt_add_billing_inst;

SET @add_collected_amt = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND column_name = 'collected_amount_cents') > 0,
    'SELECT 1',
    'ALTER TABLE `commission_installments` ADD COLUMN `collected_amount_cents` BIGINT NULL'
);
PREPARE stmt_add_collected_amt FROM @add_collected_amt;
EXECUTE stmt_add_collected_amt;
DEALLOCATE PREPARE stmt_add_collected_amt;

SET @mod_inst_status = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND column_name = 'status'
       AND LOCATE('pending_billing_data', column_type) > 0) > 0,
    'SELECT 1',
    'ALTER TABLE `commission_installments` MODIFY COLUMN `status` ENUM(''scheduled'', ''paid'', ''cancelled'', ''pending_billing_data'') NOT NULL DEFAULT ''scheduled'''
);
PREPARE stmt_mod_inst_status FROM @mod_inst_status;
EXECUTE stmt_mod_inst_status;
DEALLOCATE PREPARE stmt_mod_inst_status;

SET @mod_payout_date = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND column_name = 'payout_date'
       AND is_nullable = 'YES') > 0,
    'SELECT 1',
    'ALTER TABLE `commission_installments` MODIFY COLUMN `payout_date` DATE NULL'
);
PREPARE stmt_mod_payout_date FROM @mod_payout_date;
EXECUTE stmt_mod_payout_date;
DEALLOCATE PREPARE stmt_mod_payout_date;

SET @mod_payout_label = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND column_name = 'payout_period_label'
       AND is_nullable = 'YES') > 0,
    'SELECT 1',
    'ALTER TABLE `commission_installments` MODIFY COLUMN `payout_period_label` VARCHAR(32) NULL'
);
PREPARE stmt_mod_payout_label FROM @mod_payout_label;
EXECUTE stmt_mod_payout_label;
DEALLOCATE PREPARE stmt_mod_payout_label;

SET @mod_amount = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND column_name = 'amount_cents'
       AND is_nullable = 'YES') > 0,
    'SELECT 1',
    'ALTER TABLE `commission_installments` MODIFY COLUMN `amount_cents` BIGINT NULL'
);
PREPARE stmt_mod_amount FROM @mod_amount;
EXECUTE stmt_mod_amount;
DEALLOCATE PREPARE stmt_mod_amount;

SET @drop_inst_num = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND constraint_name = 'chk_installment_number') > 0,
    'ALTER TABLE `commission_installments` DROP CONSTRAINT `chk_installment_number`',
    'SELECT 1'
);
PREPARE stmt_drop_inst_num FROM @drop_inst_num;
EXECUTE stmt_drop_inst_num;
DEALLOCATE PREPARE stmt_drop_inst_num;

SET @add_inst_num = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE table_schema = DATABASE()
       AND table_name = 'commission_installments'
       AND constraint_name = 'chk_installment_number') > 0,
    'SELECT 1',
    'ALTER TABLE `commission_installments` ADD CONSTRAINT chk_installment_number CHECK (installment_number IN (1, 2, 3))'
);
PREPARE stmt_add_inst_num FROM @add_inst_num;
EXECUTE stmt_add_inst_num;
DEALLOCATE PREPARE stmt_add_inst_num;

INSERT INTO commission_plans (plan_key, name, description, active) VALUES (
  'standard',
  'Standard Sales Commission',
  'Default company plan. Maintenance: 3 percent of first-year annual contract value, schedule maintenance_3_payment (three payments; only the first is dated until billing exists). Construction: marginal calendar-year tiers for new clients (0.4 percent to $1M, 0.8 percent to $2M, 1.2 percent above) and existing clients (0 percent on the first $3M, 0.4 percent above), schedule construction_billing_quarterly. Enhancement rules are stored and are not calculated until gross-profit and collections exist, schedule enhancement_month_after_quarter.',
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
  ('rule-standard-maint', 'standard', 'maintenance', NULL, 0, NULL, 0.03000, 'first_year_revenue', 'maintenance_3_payment', '2024-03-13'),
  ('rule-standard-install-new-0', 'standard', 'install', 'new', 0, 100000000, 0.00400, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-install-new-1m', 'standard', 'install', 'new', 100000000, 200000000, 0.00800, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-install-new-2m', 'standard', 'install', 'new', 200000000, NULL, 0.01200, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-install-existing-0', 'standard', 'install', 'existing', 0, 300000000, 0.00000, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-install-existing-3m', 'standard', 'install', 'existing', 300000000, NULL, 0.00400, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-enh-new-gp55', 'standard', 'enhancement', 'new', 0, NULL, 0.03000, 'enhancement_collected_gp_gte_55', 'enhancement_month_after_quarter', '2024-03-08'),
  ('rule-standard-enh-gp50-over-5k', 'standard', 'enhancement', NULL, 500001, NULL, 0.01500, 'enhancement_collected_gp_gte_50', 'enhancement_month_after_quarter', '2024-03-08'),
  ('rule-standard-enh-gp45-over-10k', 'standard', 'enhancement', NULL, 1000001, NULL, 0.01500, 'enhancement_collected_gp_gte_45', 'enhancement_month_after_quarter', '2024-03-08')
ON DUPLICATE KEY UPDATE
  payout_schedule = VALUES(payout_schedule);


-- Rebuild installment rows into the plan-document shape.
-- Do not re-run this block after Aspire billing has been applied to these
-- rows: it deletes every installment and writes the pending schedule again.
DELETE FROM commission_installments;

UPDATE commissions c
JOIN estimates e ON e.id = c.estimate_id
SET c.contract_start_date = e.service_start_date
WHERE c.contract_start_date IS NULL
  AND e.service_start_date IS NOT NULL;

-- Maintenance: three rows. Payment 1 is dated at the end of the start quarter.
-- Payments 2 and 3 wait on billing installments 6 and 12.
INSERT INTO commission_installments
  (id, commission_id, installment_number, payout_period_label, payout_date, amount_cents, status, billing_installment_number, collected_amount_cents, paid_at)
SELECT
  UUID(),
  src.id,
  src.installment_number,
  CASE
    WHEN src.payout_date IS NULL THEN NULL
    ELSE CONCAT(
      ELT(MONTH(src.payout_date),
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'),
      ' ',
      YEAR(src.payout_date)
    )
  END,
  src.payout_date,
  src.amount_cents,
  src.installment_status,
  src.billing_installment_number,
  NULL,
  src.paid_at
FROM (
  SELECT
    c.id,
    n.installment_number,
    CASE
      WHEN n.installment_number = 1 THEN CAST(ROUND(c.commission_amount_cents / 2) AS SIGNED)
      WHEN n.installment_number = 2 THEN c.commission_amount_cents - CAST(ROUND(c.commission_amount_cents / 2) AS SIGNED)
      ELSE NULL
    END AS amount_cents,
    CASE
      WHEN n.installment_number <> 1 THEN NULL
      WHEN QUARTER(d.anchor) = 1 THEN DATE(CONCAT(YEAR(d.anchor), '-03-31'))
      WHEN QUARTER(d.anchor) = 2 THEN DATE(CONCAT(YEAR(d.anchor), '-06-30'))
      WHEN QUARTER(d.anchor) = 3 THEN DATE(CONCAT(YEAR(d.anchor), '-09-30'))
      ELSE DATE(CONCAT(YEAR(d.anchor), '-12-31'))
    END AS payout_date,
    CASE n.installment_number
      WHEN 2 THEN 6
      WHEN 3 THEN 12
      ELSE NULL
    END AS billing_installment_number,
    CASE
      WHEN c.status = 'cancelled' THEN 'cancelled'
      WHEN c.status = 'paid' AND n.installment_number = 1 THEN 'paid'
      WHEN n.installment_number = 1 THEN 'scheduled'
      ELSE 'pending_billing_data'
    END AS installment_status,
    CASE
      WHEN c.status = 'paid' AND n.installment_number = 1 THEN c.paid_at
      ELSE NULL
    END AS paid_at
  FROM commissions c
  LEFT JOIN estimates e ON e.id = c.estimate_id
  JOIN (
    SELECT
      id,
      COALESCE(
        contract_start_date,
        DATE(COALESCE(CONVERT_TZ(created_at, '+00:00', 'America/New_York'), created_at))
      ) AS anchor
    FROM commissions
  ) d ON d.id = c.id
  JOIN (
    SELECT 1 AS installment_number
    UNION ALL
    SELECT 2
    UNION ALL
    SELECT 3
  ) n
  WHERE COALESCE(e.estimate_type, '') = 'maintenance'
) src;

-- Construction, enhancement, and any other non-maintenance commission:
-- one payout row with a null date and a null amount until collections exist.
INSERT INTO commission_installments
  (id, commission_id, installment_number, payout_period_label, payout_date, amount_cents, status, billing_installment_number, collected_amount_cents, paid_at)
SELECT
  UUID(),
  c.id,
  1,
  NULL,
  NULL,
  NULL,
  CASE
    WHEN c.status = 'cancelled' THEN 'cancelled'
    WHEN c.status = 'paid' THEN 'paid'
    ELSE 'pending_billing_data'
  END,
  NULL,
  NULL,
  CASE WHEN c.status = 'paid' THEN c.paid_at ELSE NULL END
FROM commissions c
LEFT JOIN estimates e ON e.id = c.estimate_id
WHERE COALESCE(e.estimate_type, '') <> 'maintenance';
