-- ---------------------------------------------------------------------------
-- Migration 066 — assign the standard commission plan to sales users.
--
-- Data only. Depends on 065 for commission_plans.standard and
-- user_commission_plans. Does not change commission_rates.
--
-- Every commission-earning sales user gets plan_key 'standard' effective
-- 2026-09-25, a fixed date so a re-run cannot open a second row. The role
-- list is the commission-earning roles that exist after this change:
-- sales, outside_sales, maintenance_sales, install_sales, inside_sales.
-- inside_sales is included because it is in authz.SALES_REP_DB_ROLES.
-- Both the legacy names and the split field-sales names are listed, so the
-- assignment is the same whether or not a later role rename has landed.
--
-- Michelle Cady and Rodrigo Leon are matched by exact trimmed lower-case
-- users.name (the only name column). Seeds do not store their emails on
-- users. If either name is not exactly one user, the guard below aborts
-- the whole assignment: nobody is excluded by a fuzzy match, and nobody
-- is given the standard plan. The failing statement names the two counts.
--
-- An explicit user_commission_plans row takes precedence over a legacy
-- commission_rates row, so this moves every other sales user onto the
-- standard plan.
--
-- Idempotent: INSERT IGNORE plus NOT EXISTS on (user_id, plan_key, date),
-- which is also covered by uq_user_commission_plans_user_effective.
-- The marker row is written last. detect_066 keys on that row, not on who
-- currently holds a plan, so a rep hired later is not backdated on re-run.
-- ---------------------------------------------------------------------------

SET @michelle_cnt = (
  SELECT COUNT(*) FROM users WHERE LOWER(TRIM(name)) = 'michelle cady'
);
SET @rodrigo_cnt = (
  SELECT COUNT(*) FROM users WHERE LOWER(TRIM(name)) = 'rodrigo leon'
);
SET @guard_sql = IF(
  @michelle_cnt = 1 AND @rodrigo_cnt = 1,
  'SELECT 1',
  CONCAT(
    'INSERT INTO `066_abort_cady_',
    @michelle_cnt,
    '_leon_',
    @rodrigo_cnt,
    '` (id) VALUES (1)'
  )
);
PREPARE stmt_066_guard FROM @guard_sql;
EXECUTE stmt_066_guard;
DEALLOCATE PREPARE stmt_066_guard;

INSERT IGNORE INTO user_commission_plans (id, user_id, plan_key, effective_date)
SELECT
  UUID(),
  u.id,
  'standard',
  '2026-09-25'
FROM users u
WHERE u.role IN ('sales', 'outside_sales', 'maintenance_sales', 'install_sales', 'inside_sales')
  AND LOWER(TRIM(u.name)) <> 'michelle cady'
  AND LOWER(TRIM(u.name)) <> 'rodrigo leon'
  AND NOT EXISTS (
    SELECT 1 FROM user_commission_plans existing
    WHERE existing.user_id = u.id
      AND existing.plan_key = 'standard'
      AND existing.effective_date = '2026-09-25'
  );

CREATE TABLE IF NOT EXISTS commission_migration_markers (
  migration_id VARCHAR(64) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (migration_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO commission_migration_markers (migration_id)
VALUES ('066_assign_standard_commission_plan');
