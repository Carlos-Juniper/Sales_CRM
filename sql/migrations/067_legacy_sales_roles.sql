-- ---------------------------------------------------------------------------
-- Migration 067 — legacy sales roles become maintenance sales
--
-- Numbered 067. The open commissions PR uses 065 and 066, so this file
-- does not take either number.
--
-- users has a full-name column (`name`) and `email`. There is no separate
-- first/last name column.
--
-- Every users row whose role is 'sales' or 'outside_sales' becomes
-- 'maintenance_sales', except Michelle Cady, who becomes 'vp_sales' when
-- exactly one of those rows matches her:
--   * TRIM(LOWER(name)) is "michelle cady", or
--   * TRIM(LOWER(name)) is "cady, michelle" (comma, flexible whitespace), or
--   * LOWER(email) contains "cady".
-- Zero matches or more than one match: those rows stay on their current
-- role and scripts/migrate.py prints a warning. The deploy does not fail.
-- Rodrigo Leon has no special case: a legacy sales role becomes
-- maintenance_sales with everyone else.
--
-- Rows on any other role (admin, manager, inside_sales, marketing,
-- estimators, vp_sales, maintenance_sales, …) are not updated.
-- Re-running is a no-op once no sales/outside_sales rows remain.
-- The predicate text matches scripts/migrate.py MICHELLE_CADY_PREDICATE.
-- ---------------------------------------------------------------------------

SET @michelle_matches = (
    SELECT COUNT(*) FROM users
    WHERE role IN ('sales', 'outside_sales')
      AND (
    LOWER(TRIM(name)) REGEXP '^michelle[[:space:]]+cady$'
    OR LOWER(TRIM(name)) REGEXP '^cady[[:space:]]*,[[:space:]]*michelle$'
    OR LOWER(email) LIKE '%cady%'
)
);

UPDATE users
   SET role = 'maintenance_sales'
 WHERE role IN ('sales', 'outside_sales')
   AND NOT (
    LOWER(TRIM(name)) REGEXP '^michelle[[:space:]]+cady$'
    OR LOWER(TRIM(name)) REGEXP '^cady[[:space:]]*,[[:space:]]*michelle$'
    OR LOWER(email) LIKE '%cady%'
);

UPDATE users
   SET role = 'vp_sales'
 WHERE @michelle_matches = 1
   AND role IN ('sales', 'outside_sales')
   AND (
    LOWER(TRIM(name)) REGEXP '^michelle[[:space:]]+cady$'
    OR LOWER(TRIM(name)) REGEXP '^cady[[:space:]]*,[[:space:]]*michelle$'
    OR LOWER(email) LIKE '%cady%'
);
