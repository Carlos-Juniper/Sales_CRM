-- ---------------------------------------------------------------------------
-- Migration 065 — commission payout installments and standard plan rules.
--
-- Payout cadence is data on commission_plan_rules.payout_schedule:
--   maintenance_3_payment — three installments. Payment 1 is half of the
--     annual commission at the end of the quarter the contract starts in.
--     Payment 2 is the other half and waits on the 6th billing installment.
--     Payment 3 waits on additional revenue through the 12th installment.
--   construction_billing_quarterly — one row, pending billing and collections.
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
-- commissions already exists (migration 054). The three ALTERs below add
-- plan_key, client_type, and contract_start_date. Tables created in this
-- file are not altered again here.
--
-- Backfill INSERTs are INSERT IGNORE against uq_commission_installment so a
-- partial re-apply does not rewrite a paid installment. There is no DELETE.
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

ALTER TABLE commissions ADD COLUMN plan_key VARCHAR(64) NULL;
ALTER TABLE commissions ADD COLUMN client_type VARCHAR(32) NULL;
ALTER TABLE commissions ADD COLUMN contract_start_date DATE NULL;

INSERT INTO commission_plans (plan_key, name, description, active) VALUES (
  'standard',
  'Standard Sales Commission',
  'Default company plan. Maintenance: 3 percent of first-year annual contract value, schedule maintenance_3_payment (three payments; only the first is dated until billing exists). Construction: marginal calendar-year tiers for new clients (0.4 percent to $1M, 0.8 percent to $2M, 1.2 percent above) and existing clients (0 percent on the first $3M, 0.4 percent above), schedule construction_billing_quarterly.',
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description);

-- Rates are data. tier_max_cents is exclusive. Dollars converted to cents:
-- $1M = 100000000, $2M = 200000000, $3M = 300000000.
INSERT INTO commission_plan_rules
  (id, plan_key, estimate_type, client_type, tier_min_cents, tier_max_cents, rate, basis, payout_schedule, effective_date)
VALUES
  ('rule-standard-maint', 'standard', 'maintenance', NULL, 0, NULL, 0.03000, 'first_year_revenue', 'maintenance_3_payment', '2024-03-13'),
  ('rule-standard-install-new-0', 'standard', 'install', 'new', 0, 100000000, 0.00400, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-install-new-1m', 'standard', 'install', 'new', 100000000, 200000000, 0.00800, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-install-new-2m', 'standard', 'install', 'new', 200000000, NULL, 0.01200, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-install-existing-0', 'standard', 'install', 'existing', 0, 300000000, 0.00000, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13'),
  ('rule-standard-install-existing-3m', 'standard', 'install', 'existing', 300000000, NULL, 0.00400, 'calendar_year_cumulative_revenue', 'construction_billing_quarterly', '2024-03-13')
ON DUPLICATE KEY UPDATE
  payout_schedule = VALUES(payout_schedule);

UPDATE commissions c
JOIN estimates e ON e.id = c.estimate_id
SET c.contract_start_date = e.service_start_date
WHERE c.contract_start_date IS NULL
  AND e.service_start_date IS NOT NULL;

-- Maintenance: three rows. Payment 1 is dated at the end of the start quarter.
-- Payments 2 and 3 wait on billing installments 6 and 12.
-- INSERT IGNORE leaves an existing (commission_id, installment_number) alone,
-- including a row that has already been marked paid.
INSERT IGNORE INTO commission_installments
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

-- Install and any other non-maintenance commission: one payout row with a
-- null date and a null amount until collections exist.
INSERT IGNORE INTO commission_installments
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
