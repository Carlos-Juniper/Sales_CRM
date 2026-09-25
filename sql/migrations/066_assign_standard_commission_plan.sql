-- ---------------------------------------------------------------------------
-- Migration 066 — assign the standard commission plan to sales users.
--
-- Data only. Depends on 065 for commission_plans.standard and
-- user_commission_plans. Does not change commission_rates.
--
-- Every commission-earning sales user gets plan_key 'standard' effective
-- 2026-09-25, a fixed date so a re-run cannot open a second row. The role
-- list is the union of today's values and the values migration 067 will
-- write (sales and outside_sales become maintenance_sales; Michelle Cady
-- becomes vp_sales), so the two files can apply in either order.
--
-- inside_sales is included because it is in authz.SALES_REP_DB_ROLES.
-- vp_sales is included for the same ordering reason.
--
-- Michelle Cady and Rodrigo Leon get no row. Match is case-insensitive on
-- trimmed users.name (the only name column) or an email containing cady / leon.
-- The runner warns when either person matches zero users or more than one.
-- Every match is excluded. Their commission_rates rows stay as they are.
--
-- An explicit user_commission_plans row takes precedence over a legacy
-- commission_rates row, so this moves every other sales user onto the
-- standard plan.
--
-- Idempotent: INSERT IGNORE plus NOT EXISTS on (user_id, plan_key, date),
-- which is also covered by uq_user_commission_plans_user_effective.
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO user_commission_plans (id, user_id, plan_key, effective_date)
SELECT
  UUID(),
  u.id,
  'standard',
  '2026-09-25'
FROM users u
WHERE u.role IN ('sales', 'outside_sales', 'maintenance_sales', 'install_sales', 'inside_sales', 'vp_sales')
  AND NOT (LOWER(TRIM(u.name)) = 'michelle cady' OR (LOWER(TRIM(u.name)) LIKE '%michelle%' AND LOWER(TRIM(u.name)) LIKE '%cady%') OR LOWER(u.email) LIKE '%cady%')
  AND NOT (LOWER(TRIM(u.name)) = 'rodrigo leon' OR (LOWER(TRIM(u.name)) LIKE '%rodrigo%' AND LOWER(TRIM(u.name)) LIKE '%leon%') OR LOWER(u.email) LIKE '%leon%')
  AND NOT EXISTS (
    SELECT 1 FROM user_commission_plans existing
    WHERE existing.user_id = u.id
      AND existing.plan_key = 'standard'
      AND existing.effective_date = '2026-09-25'
  );
