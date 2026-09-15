-- Migration 043 — Seed licenses_certifications with scanned credential documents
--
-- Source files uploaded to GCS_ATTACHMENTS_BUCKET (juniper-crm-attachments-prod)
-- under the prefix certifications/{branch}/ on 2026-09-15.
--
-- aspire_branch_id NULL = company-wide (Regional Directors whose licenses apply
-- across the region). Non-NULL = branch-specific credential shown only when
-- that branch is selected on the proposal.
--
-- object_key is the PDF version of the scan where both PDF + PNG were supplied;
-- PDF is the canonical document. Corresponding PNGs are in GCS at the same
-- prefix with .png extension, available for inline display if needed.
--
-- identifier (license number) and issued_date are NULL — not visible on the
-- scanned documents; can be updated through the Settings > Licenses UI once live.
--
-- "Kyle Leverette (Fort Myers).png" was uploaded but has no license type label;
-- it is omitted from this seed and should be reviewed manually before adding.

INSERT IGNORE INTO `licenses_certifications`
    (id, kind, name, issuing_body, holder_name,
     aspire_branch_id, expiry_date, object_key, active, sort_order)
VALUES
-- ── Josh Burton — Regional Director, Central Florida (company-wide) ──────────
('lc-jb-diploma',
 'certification',
 'B.S. Horticultural Science & Business Administration',
 'Florida Southern College',
 'Josh Burton',
 NULL,          -- company-wide
 NULL,          -- degrees do not expire
 'certifications/orlando/Josh Burton (Orlando) - College Diploma.pdf',
 1, 10),

('lc-jb-irrigation',
 'license',
 'State Certified Irrigation Contractor',
 'Florida Department of Business and Professional Regulation',
 'Josh Burton',
 NULL,          -- company-wide
 '2028-12-31',  -- "2028" parsed from filename; exact date TBD
 'certifications/orlando/Josh Burton (Orlando) - Irrigation License 2028.pdf',
 1, 20),

('lc-jb-pestcontrol',
 'license',
 'Certified Pest Control Operator',
 'Florida Department of Agriculture and Consumer Services',
 'Josh Burton',
 NULL,          -- company-wide
 NULL,
 'certifications/orlando/Josh Burton (Orlando)  - Pest Control License.pdf',
 1, 30),

-- ── Kyle Leverette — Regional Director, Southwest Florida (company-wide) ─────
('lc-kl-pestcontrol',
 'license',
 'Certified Pest Control Operator',
 'Florida Department of Agriculture and Consumer Services',
 'Kyle Leverette',
 NULL,          -- company-wide
 NULL,
 'certifications/fort-myers/Kyle Leverette (Fort Myers) - Pest Control.pdf',
 1, 40),

-- ── Andrew Crespo — Fort Myers Maintenance (3696) ───────────────────────────
('lc-ac-pestcontrol',
 'license',
 'Certified Pest Control Operator',
 'Florida Department of Agriculture and Consumer Services',
 'Andrew Crespo',
 3696,
 NULL,
 'certifications/fort-myers/Andrew Crespo (Frot Myers) - Certified Pest Control.pdf',
 1, 50),

('lc-ac-water',
 'license',
 'Irrigation / Water Use License',
 'Florida Department of Business and Professional Regulation',
 'Andrew Crespo',
 3696,
 NULL,
 'certifications/fort-myers/Andrew Crespo (Fort Myers)- Water License.pdf',
 1, 60),

-- ── Adam Phelps — Bonita Springs Maintenance (1412) ─────────────────────────
('lc-ap-pestcontrol',
 'license',
 'Certified Pest Control Operator',
 'Florida Department of Agriculture and Consumer Services',
 'Adam Phelps',
 1412,
 NULL,
 'certifications/bonita-springs/Adam Phelps (Bonita Springs) - Certified Pest Control.png',
 1, 70);
