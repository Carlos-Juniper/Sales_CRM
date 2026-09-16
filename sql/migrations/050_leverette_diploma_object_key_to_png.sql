-- Migration 050 — Fix lc-kl-diploma's object_key on DBs where 048 already ran
--
-- Migration 048's object_key was corrected to .png (see its updated comment)
-- before this DB re-ran it, so on a fresh install 048 alone is sufficient.
-- On a DB where 048 already applied with the original .pdf key, this UPDATE
-- repoints it — same reasoning as migration 049 for lc-jb-diploma: the
-- proposal page's <img>-based LicenseImage cannot display a PDF.

UPDATE `licenses_certifications`
SET object_key = 'certifications/fort-myers/Kyle Leverette (Fort Myers) - College Diploma.png'
WHERE id = 'lc-kl-diploma';
