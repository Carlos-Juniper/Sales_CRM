-- ---------------------------------------------------------------------------
-- Migration 029 — Handoff 46 §5: replace placeholder proposal seed data
--
-- Migration 015 (Handoff 37 Slice 3) shipped MVP placeholder rows that render
-- straight into client-facing proposal PDFs. Five of those placeholders are
-- corrected here. 015 is applied in every environment including prod and is
-- left in its shipped state on purpose — this is a SEPARATE, later migration
-- so 015's checksum never changes.
--
-- Idempotent by construction: DELETE ... WHERE, UPDATE ... WHERE, and
-- INSERT IGNORE with fixed primary keys are all safe to re-run. The migrate.py
-- runner records 029 after the first apply; there is no non-idempotent schema
-- signal here (no DROP), so — like migration 028 — 029 is auto-discovered by
-- the migration_files() glob and needs no _DETECT drift-detector entry.
--
-- Real referee data source: Handoff 45 §4.10 (three real client references).
-- Placeholder inventory source: Handoff 46 §5 (items 5.1–5.5).
--
-- Address note: §4.10 supplies no street address for the three real referees,
-- and `client_references.address` is NOT NULL. We do NOT invent street
-- addresses. `address` is seeded as '' (empty) — the property_name carries the
-- identifying location, and the Handoff 46 §5 pre-send guard is designed to
-- surface an empty COMPANY_INFO/address value for later fill via the Handoff 38
-- Settings admin UI.
-- ---------------------------------------------------------------------------


-- ── 5.1 Invented founder bio (executive team page) ──────────────────────────
--    015 seeded tm-exec-ceo-001 ('Carlos Hernandez', team_type='executive')
--    with a fabricated company-history bio attributed to the proposal signer.
--    Pointe Jupiter's real executive page is Brandon Duke / Dan DeMont /
--    Jake Rubin — NOT this person. We do not paraphrase another person's bio.
--    Delete the row entirely: the executive page is an optional section and
--    simply will not render if no real executive roster exists.
DELETE FROM `team_members` WHERE id = 'tm-exec-ceo-001';


-- ── 5.2 CRM Rep Placeholder (org chart + team page) ─────────────────────────
--    015 comment: "settings handoff links to real user". Handoff 38 shipped
--    that admin UI. Clear the placeholder name — the team page suppresses cards
--    without a name — and leave the row for a real user to be linked via
--    Settings. Guard on both id and the placeholder name so a real name entered
--    via Settings is never clobbered on re-run.
UPDATE `team_members`
   SET name = ''
 WHERE id = 'tm-am-ftm-001'
   AND name = 'CRM Rep Placeholder';


-- ── 5.3 Fort Myers Production Manager (job title used as a person's name) ────
--    The null-user row is deliberate and permanent by design (non-CRM staff);
--    only the NAME is a stand-in. Clear the placeholder name; leave the row
--    active. Guarded so a real name entered via Settings survives a re-run.
UPDATE `team_members`
   SET name = ''
 WHERE id = 'tm-pm-ftm-001'
   AND name = 'Fort Myers Production Manager';


-- ── 5.4 / 5.5 Mock client references (fictional 555 phones) ─────────────────
--    015 seeded two invented references — 'Coral Bay HOA' (cr-001) and
--    'Pointe Jupiter Yacht Club' (cr-002) — which are the two reference
--    proposals themselves, with fictional (561) 555-0100 / (239) 555-0142
--    numbers. cr-001 also seeded Michelle Cady as the referring property
--    manager, i.e. the same person seeded as a Juniper Regional Director on the
--    team page (§5.5). Delete both mock rows; the real referees replace them.
DELETE FROM `client_references` WHERE id IN ('cr-001', 'cr-002');
--    Belt-and-suspenders: also clear any row still carrying a fictional
--    555-01xx number, in case ids were changed downstream.
DELETE FROM `client_references`
 WHERE phone IN ('(561) 555-0100', '(239) 555-0142');


-- ── 5.4 Real client references (Handoff 45 §4.10) ───────────────────────────
--    Three real referees, seeded company-wide (aspire_branch_id NULL = shown
--    for any branch query, per migration 015 Amendment A.6). INSERT IGNORE on a
--    fixed primary key makes each row re-runnable.

INSERT IGNORE INTO `client_references`
    (id, aspire_branch_id, property_name, services_provided,
     contact_name, contact_title, phone, email, address,
     client_since_year, active)
VALUES
-- Greyhawk at Golf Club of the Everglades
('cr-real-greyhawk',
 NULL,
 'Greyhawk at Golf Club of the Everglades',
 'All Landscape Maintenance Services',
 'Brett Beaver',
 'LCAM',
 '206-206-3000',
 'generalmanager@greyhawkhoa.com',
 '',   -- §4.10 supplies no street address; NOT NULL column, do not invent
 2014,
 1),

-- 1800 homes and common area
('cr-real-1800homes',
 NULL,
 '1800 homes and common area',
 'all landscape maintenance services',
 'Billie Parker',
 NULL,
 '239-513-0045',
 'billie.parker@castlegroup.com',
 '',   -- §4.10 supplies no street address; NOT NULL column, do not invent
 2020,
 1),

-- River Hall
('cr-real-riverhall',
 NULL,
 'River Hall',
 '400 homes and common areas all landscape services',
 'Vania Peal CAM, CMCA, AMS',
 'Evergreen Lifestyle Management',
 '239-237-2952',
 'vpeal@evergreen-lm.com',
 '',   -- §4.10 supplies no street address; NOT NULL column, do not invent
 2024,
 1);
