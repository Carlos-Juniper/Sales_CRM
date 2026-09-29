-- ---------------------------------------------------------------------------
-- Migration 065 — commission payout installments and standard plan rules.
--
-- Payout cadence is not a column. The application maps estimate type once:
--   maintenance → maintenance_3_payment (three installments; payment 1 is
--     half of the annual commission at the end of the start quarter;
--     payment 2 waits on the 6th billing installment; payment 3 waits on
--     additional revenue through the 12th installment).
--   install → construction_billing_quarterly (one row, pending billing).
-- Existing commissions are backfilled by scripts/migrate.py apply_065,
-- which calls the same commission_calc helpers as a won estimate.
-- commission_billing_events is an empty ledger for a later Aspire backfill.
-- This file does not insert billing rows and does not invent collection dates.
-- No per-user plan rows are inserted. commission_rates rows are not modified.
-- A legacy rate still controls the amount. Timing follows the estimate type.
--
-- Deferred until the Enhancement sale type exists. estimates.estimate_type
-- is maintenance or install, so these rates are not seeded: 3 percent for a
-- new client at 55 percent gross profit or higher, 1.5 percent on amounts
-- over 5000 dollars at 50 percent gross profit or higher, and 1.5 percent
-- on amounts over 10000 dollars at 45 percent gross profit or higher.
--
-- commissions already exists (migration 054). The three guarded ALTERs add
-- plan_key, client_type, and contract_start_date. Each ADD is skipped when
-- the column is already there, so a partial re-apply is safe. Tables
-- created in this file are not altered again here.
--
-- There is no DELETE and no installment INSERT in this file.
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

SET @add_commissions_plan_key = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commissions'
       AND column_name = 'plan_key') > 0,
    'SELECT 1',
    'ALTER TABLE commissions ADD COLUMN plan_key VARCHAR(64) NULL'
);
PREPARE stmt_add_commissions_plan_key FROM @add_commissions_plan_key;
EXECUTE stmt_add_commissions_plan_key;
DEALLOCATE PREPARE stmt_add_commissions_plan_key;

SET @add_commissions_client_type = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commissions'
       AND column_name = 'client_type') > 0,
    'SELECT 1',
    'ALTER TABLE commissions ADD COLUMN client_type VARCHAR(32) NULL'
);
PREPARE stmt_add_commissions_client_type FROM @add_commissions_client_type;
EXECUTE stmt_add_commissions_client_type;
DEALLOCATE PREPARE stmt_add_commissions_client_type;

SET @add_commissions_contract_start = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'commissions'
       AND column_name = 'contract_start_date') > 0,
    'SELECT 1',
    'ALTER TABLE commissions ADD COLUMN contract_start_date DATE NULL'
);
PREPARE stmt_add_commissions_contract_start FROM @add_commissions_contract_start;
EXECUTE stmt_add_commissions_contract_start;
DEALLOCATE PREPARE stmt_add_commissions_contract_start;

INSERT INTO commission_plans (plan_key, name, description, active) VALUES (
  'standard',
  'Standard Sales Commission',
  'Default company plan. Maintenance: 3 percent of first-year annual contract value, schedule maintenance_3_payment (three payments, and only the first is dated until billing exists). Construction: marginal calendar-year tiers for new clients (0.4 percent to $1M, 0.8 percent to $2M, 1.2 percent above) and existing clients (0 percent on the first $3M, 0.4 percent above), schedule construction_billing_quarterly.',
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description);

-- Rates are data. tier_max_cents is exclusive. Dollars converted to cents:
-- $1M = 100000000, $2M = 200000000, $3M = 300000000.
INSERT INTO commission_plan_rules
  (id, plan_key, estimate_type, client_type, tier_min_cents, tier_max_cents, rate, basis, effective_date)
VALUES
  ('rule-standard-maint', 'standard', 'maintenance', NULL, 0, NULL, 0.03000, 'first_year_revenue', '2024-03-13'),
  ('rule-standard-install-new-0', 'standard', 'install', 'new', 0, 100000000, 0.00400, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-install-new-1m', 'standard', 'install', 'new', 100000000, 200000000, 0.00800, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-install-new-2m', 'standard', 'install', 'new', 200000000, NULL, 0.01200, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-install-existing-0', 'standard', 'install', 'existing', 0, 300000000, 0.00000, 'calendar_year_cumulative_revenue', '2024-03-13'),
  ('rule-standard-install-existing-3m', 'standard', 'install', 'existing', 300000000, NULL, 0.00400, 'calendar_year_cumulative_revenue', '2024-03-13')
ON DUPLICATE KEY UPDATE
  rate = VALUES(rate),
  basis = VALUES(basis),
  tier_min_cents = VALUES(tier_min_cents),
  tier_max_cents = VALUES(tier_max_cents);

UPDATE commissions c
JOIN estimates e ON e.id = c.estimate_id
SET c.contract_start_date = e.service_start_date
WHERE c.contract_start_date IS NULL
  AND e.service_start_date IS NOT NULL;

-- One current plan row per user. Mirrors v_current_commission_rates (054):
-- effective on or before today, and not expired. ROW_NUMBER keeps the latest
-- effective_date when more than one row overlaps.
CREATE OR REPLACE VIEW v_current_commission_plans AS
SELECT user_id, plan_key, plan_name, effective_date
FROM (
  SELECT
    ucp.user_id,
    ucp.plan_key,
    cp.name AS plan_name,
    ucp.effective_date,
    ROW_NUMBER() OVER (
      PARTITION BY ucp.user_id
      ORDER BY ucp.effective_date DESC
    ) AS rn
  FROM user_commission_plans ucp
  JOIN commission_plans cp ON cp.plan_key = ucp.plan_key
  WHERE ucp.effective_date <= CURDATE()
    AND (ucp.expires_date IS NULL OR ucp.expires_date > CURDATE())
) ranked
WHERE rn = 1;
