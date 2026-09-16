-- Migration 049 — Point diploma credentials at .png, not .pdf
--
-- Migration 043 seeded lc-jb-diploma with a .pdf object_key. The proposal
-- page renders credentials with a plain <img> tag (LicenseImage, shared.tsx),
-- which cannot display a PDF — the image silently fails to load and the card
-- never appears. Repoint it at the .png version of the same scan (uploaded to
-- GCS_ATTACHMENTS_BUCKET alongside the PDF, per migration 043's own comment
-- that both formats were supplied for scans that have one).

UPDATE `licenses_certifications`
SET object_key = 'certifications/orlando/Josh Burton (Orlando) - College Diploma.png'
WHERE id = 'lc-jb-diploma';
