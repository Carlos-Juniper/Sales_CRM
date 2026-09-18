-- ---------------------------------------------------------------------------
-- Migration 046 — Commissions schema
--
-- Tables to track sales rep commission rates and earned commissions.
-- Commission rates are populated/synced from Paycom (external process).
-- Commissions are auto-created via trigger when estimate status → 'won'.
--
-- Applied by scripts/migrate.py (detect_046 keys on commissions table).
-- ---------------------------------------------------------------------------

-- ── 1. Commission rates (populated from Paycom) ────────────────────────────

CREATE TABLE commission_rates (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  
  -- The commission rate as a decimal (0.05 = 5%, 0.075 = 7.5%)
  commission_rate DECIMAL(6,5) NOT NULL,
  
  -- Date range for this rate
  effective_date DATE NOT NULL,
  expires_date DATE NULL,  -- NULL = currently active
  
  -- Metadata from Paycom (for troubleshooting/audit)
  paycom_employee_id VARCHAR(100) NULL,
  paycom_synced_at TIMESTAMP NULL,
  
  -- Audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id),
  
  -- Ensure only one active rate per user at any point in time
  -- (overlapping date ranges would cause ambiguity)
  INDEX idx_rates_user_dates (user_id, effective_date, expires_date),
  INDEX idx_rates_effective (effective_date),
  
  CONSTRAINT chk_valid_rate CHECK (commission_rate >= 0 AND commission_rate <= 1),
  CONSTRAINT chk_valid_date_range CHECK (expires_date IS NULL OR expires_date > effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Commission records (auto-created by trigger) ────────────────────────

CREATE TABLE commissions (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  estimate_id CHAR(36) NOT NULL,
  lead_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,  -- the crm_rep who earned this commission
  
  -- Money fields (integer cents)
  contract_value_cents INT NOT NULL,
  commission_rate DECIMAL(6,5) NOT NULL,  -- snapshot of rate at time of sale
  commission_amount_cents INT NOT NULL,   -- contract_value * rate
  
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

-- ── 3. Trigger: Auto-create commission when estimate → won ─────────────────

DELIMITER //

CREATE TRIGGER trg_estimate_won_commission
AFTER UPDATE ON estimates
FOR EACH ROW
BEGIN
  DECLARE v_lead_id CHAR(36);
  DECLARE v_crm_rep_id CHAR(36);
  DECLARE v_contract_value_cents INT;
  DECLARE v_commission_rate DECIMAL(6,5);
  DECLARE v_commission_amount_cents INT;
  
  -- Only fire when status changes TO 'won' (not already won)
  IF NEW.status = 'won' AND (OLD.status IS NULL OR OLD.status != 'won') THEN
    
    -- Get the lead and its crm_rep
    SELECT id, crm_rep 
    INTO v_lead_id, v_crm_rep_id
    FROM leads
    WHERE id = NEW.lead_id;
    
    -- If no crm_rep, skip commission creation silently
    IF v_crm_rep_id IS NOT NULL THEN
      -- Calculate contract value: sum of all estimate line items
      SELECT COALESCE(SUM(total_price_cents), 0)
      INTO v_contract_value_cents
      FROM estimate_line_items
      WHERE estimate_id = NEW.id;
      
      -- Get the current commission rate for this rep as of today
      -- (Use the most recent active rate)
      SELECT commission_rate 
      INTO v_commission_rate
      FROM commission_rates
      WHERE user_id = v_crm_rep_id
        AND effective_date <= CURDATE()
        AND (expires_date IS NULL OR expires_date > CURDATE())
      ORDER BY effective_date DESC
      LIMIT 1;
      
      -- Only insert if we have a valid rate
      IF v_commission_rate IS NOT NULL THEN
        -- Calculate commission amount (round to nearest cent)
        SET v_commission_amount_cents = ROUND(v_contract_value_cents * v_commission_rate);
        
        -- Insert commission record
        -- Use INSERT IGNORE to prevent duplicates if trigger fires multiple times
        INSERT IGNORE INTO commissions (
          estimate_id,
          lead_id,
          user_id,
          contract_value_cents,
          commission_rate,
          commission_amount_cents,
          status,
          approved_at
        ) VALUES (
          NEW.id,
          v_lead_id,
          v_crm_rep_id,
          v_contract_value_cents,
          v_commission_rate,
          v_commission_amount_cents,
          'approved',
          NOW()
        );
      END IF;
    END IF;
    
  END IF;
END//

DELIMITER ;

-- ── 4. Helper views (optional, for reporting) ──────────────────────────────

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
  cr.expires_date,
  cr.paycom_employee_id,
  cr.paycom_synced_at
FROM commission_rates cr
JOIN users u ON cr.user_id = u.id
WHERE cr.effective_date <= CURDATE()
  AND (cr.expires_date IS NULL OR cr.expires_date > CURDATE())
ORDER BY u.name;
