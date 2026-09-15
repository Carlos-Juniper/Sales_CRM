-- ---------------------------------------------------------------------------
-- Migration 032 — Handoff 47: Proposal Document Uploads
--
-- Extends intake_attachments so a rep can attach the three proposal documents
-- that Aspire has no API for — the contract, the measurement totals, and a
-- catch-all — directly off the estimate. Rather than a new proposal_documents
-- table, the existing intake_attachments table gains three new `kind` values
-- (§3), mirroring migration 027's direction of consolidating document kinds
-- onto one table with one set of endpoints.
--
-- Two changes in one migration:
--
--   1. Widen the `kind` ENUM to add 'proposal_contract', 'proposal_measurements'
--      and 'proposal_other'. The live enum is
--      enum('property_map','rfp','other','takeoff_scan'); after this it carries
--      seven values.
--
--   2. Add `sort_order INT NOT NULL DEFAULT 0`. "Other attachments" needs a
--      stable, rep-controlled order, and created_at has only second resolution
--      — two files picked in the same second would otherwise order arbitrarily.
--      DEFAULT 0 leaves every existing row untouched.
--
-- Idempotency: both changes are guarded on information_schema with the dynamic
-- PREPARE/EXECUTE pattern from 033_documents_unification.sql:39-51 — the ENUM
-- guard tests COLUMN_TYPE LIKE '%proposal_contract%'; the sort_order guard tests
-- a column_name count. Running the migration twice leaves the ENUM with exactly
-- seven values and one sort_order column.
--
-- Numbering: 031 is taken by Handoff 49 (leads.property_id, applied to live crm),
-- so this is 032. Verified against schema_migrations 2026-09-08. Note the
-- unrelated 027 collision (live records 027_estimate_proposal_pdf_link from
-- another worktree) — pre-existing and out of scope for this handoff (§9).
-- ---------------------------------------------------------------------------

-- ── Step 1: Widen kind ENUM to add the three proposal kinds ─────────────────
--
-- Read the current COLUMN_TYPE from information_schema. If 'proposal_contract'
-- is already present in the type string the ALTER is skipped.

SET @widen_kind = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'intake_attachments'
       AND column_name  = 'kind'
       AND column_type LIKE '%proposal_contract%') > 0,
    'SELECT 1',
    "ALTER TABLE `intake_attachments`
       MODIFY COLUMN `kind` ENUM('property_map','rfp','other','takeoff_scan',
                                 'proposal_contract','proposal_measurements','proposal_other')
         NOT NULL DEFAULT 'other'"
);
PREPARE stmt_widen_kind FROM @widen_kind;
EXECUTE stmt_widen_kind;
DEALLOCATE PREPARE stmt_widen_kind;


-- ── Step 2: Add sort_order for stable "other attachments" ordering ──────────
--
-- Guard: only add the column if it is not already present (idempotent on re-run).

SET @add_sort_order = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'intake_attachments'
       AND column_name  = 'sort_order') > 0,
    'SELECT 1',
    'ALTER TABLE `intake_attachments`
       ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0'
);
PREPARE stmt_add_sort_order FROM @add_sort_order;
EXECUTE stmt_add_sort_order;
DEALLOCATE PREPARE stmt_add_sort_order;


-- ── Step 3: Add page_count (server-side read at confirm, §6/§7) ─────────────
--
-- The preview summary panel and the render manifest report a per-document page
-- count. The confirm endpoint already opens the file to validate it (§7), so it
-- records the count here rather than parsing PDFs in the browser. NULL for rows
-- that predate this feature and for images before confirm.

SET @add_page_count = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'intake_attachments'
       AND column_name  = 'page_count') > 0,
    'SELECT 1',
    'ALTER TABLE `intake_attachments`
       ADD COLUMN `page_count` INT NULL'
);
PREPARE stmt_add_page_count FROM @add_page_count;
EXECUTE stmt_add_page_count;
DEALLOCATE PREPARE stmt_add_page_count;


-- ── Step 4: Widen status ENUM to add 'deleted' (soft-delete, §4) ────────────
--
-- Replacing or removing a proposal document soft-deletes the row (and deletes
-- the GCS object) rather than hard-deleting it, per api/attachments.py::delete's
-- docstring ("prefer soft-delete to preserve the corpus"). The live status enum
-- is enum('pending','stored','failed'); this adds 'deleted'.

SET @widen_status = IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'intake_attachments'
       AND column_name  = 'status'
       AND column_type LIKE '%deleted%') > 0,
    'SELECT 1',
    "ALTER TABLE `intake_attachments`
       MODIFY COLUMN `status` ENUM('pending','stored','failed','deleted')
         NOT NULL DEFAULT 'pending'"
);
PREPARE stmt_widen_status FROM @widen_status;
EXECUTE stmt_widen_status;
DEALLOCATE PREPARE stmt_widen_status;
