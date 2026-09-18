-- ---------------------------------------------------------------------------
-- Migration 053 — Single-global-insurance DB constraint
--
-- Enforces the invariant: at most one active company-wide insurance document
-- may exist at any time.
--
-- Background
-- ----------
-- The API already performs a SELECT-then-INSERT 409 check in create_license
-- (api/settings.py) and kind is now immutable via PATCH (kind removed from
-- _LC_UPDATABLE, migration 053 companion fix). The app-level guard covers the
-- normal flow but has a narrow TOCTOU race: two concurrent admin requests could
-- both pass the SELECT check before either INSERT commits.
--
-- MySQL constraint design
-- -----------------------
-- MySQL does NOT support partial unique indexes with WHERE clauses (that is
-- PostgreSQL syntax). A straightforward UNIQUE (kind, active, aspire_branch_id)
-- would block multiple active licenses or certifications of different kinds for
-- the same branch, which is a valid business state.
--
-- The same NULL-folding technique used in migration 020 (material_calcs) is
-- applied here:
--
--   1. A STORED generated column `insurance_sentinel` folds the three
--      discriminator values into a single deterministic string:
--        • Non-insurance rows  → NULL            (excluded from UNIQUE index)
--        • Active global ins.  → 'insurance_1_0' (exactly one allowed)
--        • Inactive global ins → NULL            (soft-deleted; excluded)
--        • Active branch ins.  → NULL            (not enforced at DB level;
--                                                  the API 422s these already)
--
--   2. A UNIQUE index on (insurance_sentinel) rejects a second INSERT whose
--      sentinel would evaluate to 'insurance_1_0'. MySQL treats NULLs as
--      distinct in UNIQUE indexes, so all NULL rows are freely admitted.
--
-- Edge cases
-- ----------
-- * Deactivating (active=0) or deleting an insurance row: sentinel becomes NULL,
--   freeing the slot for a new active row.
-- * Branch-scoped insurance rows (aspire_branch_id IS NOT NULL): sentinel is
--   NULL, so they are outside the constraint — the API already 422s them.
-- * Race condition: if two concurrent INSERTs both produce sentinel
--   'insurance_1_0', the second commit raises a duplicate-key error (1062),
--   which the API maps to a 409.
--
-- Idempotency
-- -----------
-- The ALTER is guarded: if the column already exists (re-run), the script skips
-- it. The index guard checks information_schema before adding.
-- ---------------------------------------------------------------------------

-- ── Step 1: add the generated sentinel column ────────────────────────────────
-- NULL for all non-insurance rows, NULL for inactive insurance, NULL for
-- branch-scoped insurance. Only active company-wide insurance rows produce a
-- non-NULL value, making them subject to the UNIQUE constraint below.

SET @col_exists = (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'licenses_certifications'
      AND COLUMN_NAME  = 'insurance_sentinel'
);

SET @sql = IF(
    @col_exists = 0,
    "ALTER TABLE licenses_certifications
         ADD COLUMN insurance_sentinel VARCHAR(32)
             GENERATED ALWAYS AS (
                 CASE
                     WHEN kind = 'insurance'
                          AND active = 1
                          AND aspire_branch_id IS NULL
                     THEN 'insurance_1_0'
                     ELSE NULL
                 END
             ) STORED",
    'SELECT 1'  -- no-op if column already present
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── Step 2: add the unique index on the sentinel ─────────────────────────────
-- MySQL treats NULLs as distinct in UNIQUE indexes, so only 'insurance_1_0'
-- competes for uniqueness; all NULL rows are admitted freely.

SET @idx_exists = (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'licenses_certifications'
      AND INDEX_NAME   = 'uq_insurance_active_global'
);

SET @sql2 = IF(
    @idx_exists = 0,
    'ALTER TABLE licenses_certifications
         ADD UNIQUE KEY uq_insurance_active_global (insurance_sentinel)',
    'SELECT 1'
);

PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
