-- ---------------------------------------------------------------------------
-- Migration 054 — Commissions schema
--
-- Tables to track sales rep commission rates and earned commissions.
-- Commission rates are entered manually via the CRM by administrators.
-- Commissions are inserted by api/estimating.py when status transitions to
-- 'won' (see _create_commission_on_won). No trigger is used.
--
-- Applied by scripts/migrate.py (detect_046 keys on commissions table).
-- ---------------------------------------------------------------------------

-- ── 1. Commission rates ────────────────────────────────────────────────────

CREATE TABLE commission_rates (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL,
  
  -- The commission rate as a decimal (0.05 = 5%, 0.075 = 7.5%)
  commission_rate DECIMAL(6,5) NOT NULL,
  
  -- Date range for this rate
  effective_date DATE NOT NULL,
  expires_date DATE NULL,  -- NULL = currently active

  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id),
  
  INDEX idx_rates_user_dates (user_id, effective_date, expires_date),
  INDEX idx_rates_effective (effective_date),
  
  CONSTRAINT chk_valid_rate CHECK (commission_rate >= 0 AND commission_rate <= 1),
  CONSTRAINT chk_valid_date_range CHECK (expires_date IS NULL OR expires_date > effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Commission records (inserted by _create_commission_on_won) ─────────

CREATE TABLE commissions (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  estimate_id VARCHAR(36) NOT NULL,
  lead_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,  -- the crm_rep who earned this commission

  -- Money fields (integer cents)
  contract_value_cents BIGINT NOT NULL,
  commission_rate DECIMAL(6,5) NOT NULL,  -- snapshot of rate at time of sale
  commission_amount_cents BIGINT NOT NULL,   -- contract_value * rate
  
  -- Status workflow
  -- 'approved' = auto-set when created (estimate won)
  -- 'paid' = manually marked by finance during monthly payout
  -- 'cancelled' = deal fell through, commission voided
  status ENUM('approved', 'paid', 'cancelled') NOT NULL DEFAULT 'approved',
  
  approved_at TIMESTAMP NULL,
  paid_at TIMESTAMP NULL,
  payment_period VARCHAR(20) NULL,  -- 'January 2024', 'February 2024', etc.
  
  -- Audit
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (estimate_id) REFERENCES estimates(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  
  -- One commission per estimate
  UNIQUE KEY uq_commission_estimate (estimate_id),
  
  INDEX idx_commission_user (user_id),
  INDEX idx_commission_status (status),
  INDEX idx_commission_paid_at (paid_at),
  INDEX idx_commission_created_at (created_at),
  
  CONSTRAINT chk_commission_status CHECK (status IN ('approved', 'paid', 'cancelled')),
  CONSTRAINT chk_commission_positive CHECK (commission_amount_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Helper views (optional, for reporting) ──────────────────────────────

-- View: Commissions with joined user/lead/estimate data
CREATE OR REPLACE VIEW v_commissions_detail AS
SELECT 
  c.id AS commission_id,
  c.estimate_id,
  c.lead_id,
  c.user_id,
  c.contract_value_cents,
  c.commission_rate,
  c.commission_amount_cents,
  c.status,
  c.approved_at,
  c.paid_at,
  c.payment_period,
  c.created_at,
  
  -- User (rep) info
  u.name AS rep_name,
  u.email AS rep_email,
  
  -- Lead info
  l.property_name AS property_name,
  
  -- Estimate info
  e.estimate_number,
  e.aspire_number,
  e.estimate_type,
  e.status AS estimate_status
  
FROM commissions c
JOIN users u ON c.user_id = u.id
JOIN leads l ON c.lead_id = l.id
JOIN estimates e ON c.estimate_id = e.id;

-- View: Current active commission rates per user
CREATE OR REPLACE VIEW v_current_commission_rates AS
SELECT 
  cr.user_id,
  u.name AS user_name,
  u.email AS user_email,
  cr.commission_rate,
  cr.effective_date,
  cr.expires_date
FROM commission_rates cr
JOIN users u ON cr.user_id = u.id
WHERE cr.effective_date <= CURDATE()
  AND (cr.expires_date IS NULL OR cr.expires_date > CURDATE())
ORDER BY u.name;
