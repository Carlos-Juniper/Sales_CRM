-- ---------------------------------------------------------------------------
-- Migration 007 — Handoff 19: approval ladder finalization.
--
-- 1. Rename approval_tiers.role_key values to the canonical auth roles
--    (Handoff 18): branch_manager→manager, bp→vice_president, coo→ceo;
--    regional_director unchanged. Thresholds do NOT change.
-- 2. Give INSTALL the same approval ladder as maintenance (new tier rows).
-- 3. Widen estimate_adjustments.actor to VARCHAR(255) to carry the JWT
--    display name/email, matching estimate_status_transitions.actor.
--
-- Hand-run against the live `crm` DB (no `juniper.` prefix — see Handoff 15).
-- ---------------------------------------------------------------------------

-- Step 1a: widen the ENUM to hold BOTH vocabularies during the rename.
ALTER TABLE approval_tiers
    MODIFY role_key ENUM(
        'branch_manager','bp','coo',
        'manager','regional_director','vice_president','ceo'
    ) NOT NULL;

-- Step 1b: rename role_key / id / label on the seed rows.
UPDATE approval_tiers SET role_key = 'manager',        id = 'tier-maint-mgr', label = 'Manager'
    WHERE id = 'tier-maint-bm';
UPDATE approval_tiers SET role_key = 'vice_president', id = 'tier-maint-vp',  label = 'Vice President'
    WHERE id = 'tier-maint-bp';
UPDATE approval_tiers SET role_key = 'ceo',            id = 'tier-maint-ceo', label = 'CEO'
    WHERE id = 'tier-maint-coo';

-- Step 1c: narrow the ENUM to the canonical set only.
ALTER TABLE approval_tiers
    MODIFY role_key ENUM('manager','regional_director','vice_president','ceo') NOT NULL;

-- Step 2: install ladder — same $ bands as maintenance (Handoff 19 §4).
INSERT INTO approval_tiers (id, role_key, label, min_value_cents, max_value_cents, tier_order, estimate_type) VALUES
    ('tier-inst-mgr', 'manager',           'Manager',           0,         10000000,  1, 'install'),
    ('tier-inst-rd',  'regional_director', 'Regional Director', 10000000,  25000000,  2, 'install'),
    ('tier-inst-vp',  'vice_president',    'Vice President',    25000000,  100000000, 3, 'install'),
    ('tier-inst-ceo', 'ceo',               'CEO',               100000000, NULL,      4, 'install')
ON DUPLICATE KEY UPDATE label = VALUES(label);

-- Step 3: actor carries the JWT display name/email (not a 36-char id).
ALTER TABLE estimate_adjustments
    MODIFY actor VARCHAR(255) NOT NULL;
