-- Migration 048 — Add Kyle Leverette's college diploma to licenses_certifications
--
-- Migration 043 added a diploma row for Josh Burton (lc-jb-diploma) but never
-- added one for Kyle Leverette, though he has the same "degree" document type
-- from Coral Bay HOA's team-credentials appendix. Source file uploaded to
-- GCS_ATTACHMENTS_BUCKET under certifications/fort-myers/, matching the naming
-- convention of his existing pest-control scans (lc-kl-pestcontrol*).
--
-- aspire_branch_id 3696 (Fort Myers Maintenance) matches his other rows —
-- branch-specific, not company-wide, since he is not a Regional Director.
--
-- object_key is .png, not .pdf: the proposal page renders credentials with a
-- plain <img> tag (LicenseImage, shared.tsx), which cannot display a PDF —
-- see migration 049 for the same fix applied to lc-jb-diploma.

INSERT IGNORE INTO `licenses_certifications`
    (id, kind, name, issuing_body, holder_name,
     aspire_branch_id, expiry_date, object_key, active, sort_order)
VALUES
('lc-kl-diploma',
 'certification',
 'A.A.S. Turfgrass Management',
 'North Carolina State University Agricultural Institute',
 'Kyle Leverette',
 3696,
 NULL,          -- degrees do not expire
 'certifications/fort-myers/Kyle Leverette (Fort Myers) - College Diploma.png',
 1, 42);
