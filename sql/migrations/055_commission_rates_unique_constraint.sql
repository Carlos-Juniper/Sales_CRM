-- ---------------------------------------------------------------------------
-- Migration 055 — commission_rates unique constraint
--
-- Enforces the invariant that a given sales rep can have at most one rate
-- starting on a given effective_date. Without this, overlapping rows cause
-- duplicate results in v_current_commission_rates and nondeterministic
-- behavior in the /reps API endpoint.
--
-- Applied by scripts/migrate.py (detect_055 keys on the index name).
-- ---------------------------------------------------------------------------

ALTER TABLE commission_rates
  ADD CONSTRAINT uq_commission_rates_user_effective
  UNIQUE KEY (user_id, effective_date);
