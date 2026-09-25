-- ---------------------------------------------------------------------------
-- Migration 068 — unbounded approval tiers for admin and VP of Sales
--
-- approval_tiers.role_key did not include admin or vp_sales, so
-- approval_ceiling_cents returned 0 and require_approval_authority 403'd
-- every estimate above $0. Both roles are admin-equivalent and need an
-- unbounded ceiling (NULL max_value_cents) on each estimate type.
--
-- The ALTER is idempotent. The inserts use ON DUPLICATE KEY UPDATE so a
-- re-run keeps the unbounded max.
-- ---------------------------------------------------------------------------

ALTER TABLE approval_tiers
    MODIFY role_key ENUM(
        'manager',
        'regional_director',
        'vice_president',
        'ceo',
        'admin',
        'vp_sales'
    ) NOT NULL;

INSERT INTO approval_tiers
    (id, role_key, label, min_value_cents, max_value_cents, tier_order, estimate_type)
VALUES
    ('tier-maint-admin',    'admin',    'Admin',       0, NULL, 5, 'maintenance'),
    ('tier-inst-admin',     'admin',    'Admin',       0, NULL, 5, 'install'),
    ('tier-maint-vp-sales', 'vp_sales', 'VP of Sales', 0, NULL, 5, 'maintenance'),
    ('tier-inst-vp-sales',  'vp_sales', 'VP of Sales', 0, NULL, 5, 'install')
ON DUPLICATE KEY UPDATE
    role_key = VALUES(role_key),
    label = VALUES(label),
    min_value_cents = VALUES(min_value_cents),
    max_value_cents = VALUES(max_value_cents),
    tier_order = VALUES(tier_order),
    estimate_type = VALUES(estimate_type);
