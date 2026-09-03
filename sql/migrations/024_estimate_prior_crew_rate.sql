-- Migration 024: persist prior crew rate for hand-back notice (§2.6)
--
-- When an estimate is handed back to in_progress, Slice 7 clears
-- crew_rate_cents_per_hour to NULL so the estimator re-resolves the live rate.
-- But the old (submitted-at) rate is then lost, so we cannot show the
-- "Crew rate changed $X → $Y since this was submitted" notice.
--
-- This migration adds prior_crew_rate_cents_per_hour. The transition logic
-- does a single UPDATE that copies the current snapshot into the prior column
-- BEFORE nulling it, so the submitted-at rate is always preserved.

ALTER TABLE estimates
  ADD COLUMN prior_crew_rate_cents_per_hour BIGINT NULL
    COMMENT 'Crew rate (cents/hr) at last submission, preserved when clearing on in_progress re-entry';
