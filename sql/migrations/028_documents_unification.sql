-- ---------------------------------------------------------------------------
-- Migration 028 — Handoff 42: Documents Unification
--
-- Originally numbered 027; renumbered to 028 to avoid colliding with
-- 027_estimate_proposal_pdf_link.sql, which merged to staging first.
--
-- Merges insurance_certificates into licenses_certifications so that a single
-- table and a single set of API endpoints manage all three document kinds:
-- 'license', 'certification', and 'insurance'.
--
-- Design decisions:
--
--   1. kind ENUM extended to include 'insurance'.  MySQL requires ALTER TABLE to
--      widen an ENUM; the guard checks the column definition before ALTERing so
--      the statement is idempotent.
--
--   2. expiry_date nullability: existing licenses_certifications rows may have
--      NULL expiry_date (a license that "does not expire" is valid per the 018
--      comment). Adding a DB-level NOT NULL here would fail on those existing
--      rows. Decision: enforce expiry_date as REQUIRED at the API layer only
--      (both LicenseCreate and InsuranceCreate validate it). The column stays
--      nullable in the DB so the migration is safe on a production table that
--      may already contain non-expiring licenses.
--
--   3. Data migration: every insurance_certificates row becomes a
--      licenses_certifications row with kind='insurance', aspire_branch_id=NULL
--      (company-wide, matching existing behaviour), name from COALESCE(label,
--      'Insurance certificate'), and updated_at from uploaded_at.
--
--   4. DROP insurance_certificates after the data migration.  The guard ensures
--      the DROP is skipped if the table was already removed by a prior run.
--
-- Idempotency: all ALTER TABLE and data-migration steps are guarded with
-- information_schema checks (the same pattern used in migrations 014, 023).
-- ---------------------------------------------------------------------------

-- ── Step 1: Widen kind ENUM to include 'insurance' ─────────────────────────
--
-- We read the current COLUMN_TYPE from information_schema. If 'insurance' is
-- already present in the type string the ALTER is skipped.

SET @widen_kind = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'licenses_certifications'
       AND column_name  = 'kind'
       AND column_type LIKE '%insurance%') > 0,
    'SELECT 1',
    "ALTER TABLE `licenses_certifications`
       MODIFY COLUMN `kind` ENUM('license','certification','insurance') NOT NULL"
);
PREPARE stmt_widen_kind FROM @widen_kind;
EXECUTE stmt_widen_kind;
DEALLOCATE PREPARE stmt_widen_kind;


-- ── Step 2: Data-migrate insurance_certificates → licenses_certifications ───
--
-- Guard: only run if insurance_certificates still exists (idempotent on re-run
-- after DROP has already occurred).
--
-- Mapping:
--   kind             = 'insurance'
--   name             = COALESCE(label, 'Insurance certificate')
--   object_key       = object_key    (NOT NULL in insurance_certificates)
--   expiry_date      = expiry_date   (NOT NULL in insurance_certificates)
--   active           = active        (added by migration 023; safe COALESCE)
--   aspire_branch_id = NULL          (company-wide, preserves existing scope)
--   issuing_body     = NULL
--   identifier       = NULL
--   holder_name      = NULL
--   issued_date      = NULL
--   sort_order       = 0
--   updated_at       = uploaded_at   (closest timestamp; ON UPDATE will refresh
--                                    if the row is ever patched post-migration)
--
-- Duplicate guard: skip rows whose id already exists in licenses_certifications
-- (in case this migration is partially re-run).

SET @migrate_ins = IF(
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name   = 'insurance_certificates') > 0,
    "INSERT INTO `licenses_certifications`
         (id, kind, name, issuing_body, identifier, holder_name,
          aspire_branch_id, issued_date, expiry_date, object_key,
          active, sort_order, updated_at)
     SELECT
         ic.id,
         'insurance',
         COALESCE(ic.label, 'Insurance certificate'),
         NULL,   -- issuing_body
         NULL,   -- identifier
         NULL,   -- holder_name
         NULL,   -- aspire_branch_id  (company-wide)
         NULL,   -- issued_date
         ic.expiry_date,
         ic.object_key,
         COALESCE(ic.active, 1),
         0,      -- sort_order
         ic.uploaded_at
     FROM insurance_certificates ic
     WHERE ic.id NOT IN (SELECT id FROM licenses_certifications)",
    'SELECT 1'
);
PREPARE stmt_migrate FROM @migrate_ins;
EXECUTE stmt_migrate;
DEALLOCATE PREPARE stmt_migrate;


-- ── Step 3: DROP insurance_certificates ─────────────────────────────────────

SET @drop_ins = IF(
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name   = 'insurance_certificates') > 0,
    'DROP TABLE `insurance_certificates`',
    'SELECT 1'
);
PREPARE stmt_drop FROM @drop_ins;
EXECUTE stmt_drop;
DEALLOCATE PREPARE stmt_drop;
