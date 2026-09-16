-- ---------------------------------------------------------------------------
-- Migration 044 — Contract generator schema (Contract Generator, Slice 1)
--
-- Adds the fields needed to generate Landscape Maintenance Agreement pages
-- inline in proposals:
-- - catalog_items.scope_text: narrative paragraph for each kit
-- - catalog_items.billing_type: recurring vs one-time (payment schedule base)
-- - estimates.estimate_number: sequential JN-{n} fallback when not synced
--
-- Applied by scripts/migrate.py (detect_044 keys on catalog_items.scope_text).
-- ---------------------------------------------------------------------------

-- ── 1. Scope text ───────────────────────────────────────────────────────────
-- The narrative paragraph that appears on the contract for this kit.
-- NULL = heading with no body. Seeded by migration 028.
ALTER TABLE catalog_items
    ADD COLUMN scope_text TEXT NULL DEFAULT NULL AFTER service_type;

-- ── 2. Billing type ─────────────────────────────────────────────────────────
-- Recurring items appear in the 12-month payment schedule; one-time items
-- appear in the summary total but not the schedule base.
ALTER TABLE catalog_items
    ADD COLUMN billing_type ENUM('recurring','one_time') NOT NULL DEFAULT 'recurring' AFTER scope_text;

-- ── 3. Estimate number ──────────────────────────────────────────────────────
-- Sequential contract identifier when aspireNumber is not yet assigned.
-- Rendered as JN-{n}. Backfilled in created_at, id order starting at 1001.
ALTER TABLE estimates
    ADD COLUMN estimate_number INT UNSIGNED NULL DEFAULT NULL AFTER aspire_number,
    ADD UNIQUE KEY uq_estimates_number (estimate_number);

-- Backfill: assign sequential numbers to existing estimates
SET @num := 1000;
UPDATE estimates
   SET estimate_number = (@num := @num + 1)
 ORDER BY created_at, id;
