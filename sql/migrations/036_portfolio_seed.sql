-- ---------------------------------------------------------------------------
-- Migration 036 — W5g: deactivate stale portfolio placeholder rows + seed
--                      the 24-property portfolio set from the rasterized PDFs
--
-- The 3 placeholder rows seeded by migration 015 carry invented community
-- names and empty photo_object_keys arrays.  They were acceptable stand-ins
-- before the rasterization pass; now that real property images are shipping
-- under proposal/portfolio/*.jpg they must be retired.
--
-- W5g portfolio seed: 24 properties from rasterize_portfolio_pages.py run
-- on 2026-09-09.  Slugs match the JPEG filenames in studio/public/proposal/
-- portfolio/ and the manifest at sql/migrations/036_portfolio_manifest.json.
--
-- Filename typos preserved from source PDFs (Caitlyn can re-export to fix):
--   'Penbroke Pines'       (city; property name is correct: Pembroke Isles)
--   'Cory Lakes Isles'     (likely Cory Lake Isles — one word)
--   'Estencia at Wiregrass' (likely Estancia)
--   'Heritages Isles'      (Tampa variant; distinct from Heritage Isles Melbourne)
-- ---------------------------------------------------------------------------


-- ── §1 Deactivate the 3 stale placeholder rows ───────────────────────────────
--    Empty photo_object_keys + invented names — safe to deactivate now that
--    real rows replace them.  Idempotent: UPDATE WHERE is a no-op if already 0.
UPDATE portfolio_properties
   SET active = 0
 WHERE id IN ('pp-001', 'pp-002', 'pp-003');


-- ── §2 Seed real portfolio properties ────────────────────────────────────────
--    INSERT ... ON DUPLICATE KEY UPDATE makes each row idempotent: safe to
--    re-run.  IDs continue from pp-004 (the last stale row was pp-003).
--    photo_object_keys is a JSON array with the GCS object path for the first
--    (only) rasterized image.  before_after_object_keys is NULL — all new
--    portfolio properties use the flat rasterized approach.
--    sort_order drives the print order within the document.

INSERT INTO portfolio_properties
    (id, name, city_state, region_id, photo_object_keys, before_after_object_keys, sort_order, active)
VALUES

-- ── East Coast ───────────────────────────────────────────────────────────────
-- Filename typo: city is 'Penbroke Pines' in the PDF; property name is correct.
('pp-004',
 'Pembroke Isles',
 'Penbroke Pines, FL',
 'east-coast',
 '["proposal/portfolio/pembroke-isles.jpg"]',
 NULL, 10, 1),

('pp-005',
 'The Fort',
 'Fort Lauderdale, FL',
 'east-coast',
 '["proposal/portfolio/the-fort.jpg"]',
 NULL, 20, 1),

-- Melbourne variant (distinct from Tampa's 'Heritages Isles' below).
('pp-006',
 'Heritage Isles',
 'Melbourne, FL',
 'east-coast',
 '["proposal/portfolio/heritage-isles.jpg"]',
 NULL, 30, 1),

-- ── West Coast ───────────────────────────────────────────────────────────────
('pp-007',
 'Sandoval',
 'Cape Coral, FL',
 'west-coast',
 '["proposal/portfolio/sandoval.jpg"]',
 NULL, 40, 1),

('pp-008',
 'Shell Point',
 'Fort Myers, FL',
 'west-coast',
 '["proposal/portfolio/shell-point.jpg"]',
 NULL, 50, 1),

('pp-009',
 'Arboretum',
 'Naples, FL',
 'west-coast',
 '["proposal/portfolio/arboretum.jpg"]',
 NULL, 60, 1),

('pp-010',
 'Island Walk',
 'Naples, FL',
 'west-coast',
 '["proposal/portfolio/island-walk.jpg"]',
 NULL, 70, 1),

('pp-011',
 'The Isles of Collier Preserve',
 'Naples, FL',
 'west-coast',
 '["proposal/portfolio/the-isles-of-collier-preserve.jpg"]',
 NULL, 80, 1),

-- Alys Beach is in Panama City Beach folder → west-coast (defaulted by rasterizer).
('pp-012',
 'Alys Beach',
 'Panama City, FL',
 'west-coast',
 '["proposal/portfolio/alys-beach.jpg"]',
 NULL, 90, 1),

('pp-013',
 'Sanibel Inn',
 'Sanibel, FL',
 'west-coast',
 '["proposal/portfolio/sanibel-inn.jpg"]',
 NULL, 100, 1),

('pp-014',
 'South Seas Resort',
 'Sanibel, FL',
 'west-coast',
 '["proposal/portfolio/south-seas-resort.jpg"]',
 NULL, 110, 1),

('pp-015',
 'Sunseeker Resort',
 'Port Charlotte, FL',
 'west-coast',
 '["proposal/portfolio/sunseeker-resort.jpg"]',
 NULL, 120, 1),

-- Venice properties — now exported and rasterized.
('pp-016',
 'Island Walk at West Villages',
 'Venice, FL',
 'west-coast',
 '["proposal/portfolio/island-walk-at-west-villages.jpg"]',
 NULL, 130, 1),

('pp-017',
 'Sunstone at Wellen Park',
 'Venice, FL',
 'west-coast',
 '["proposal/portfolio/sunstone-at-wellen-park.jpg"]',
 NULL, 140, 1),

-- ── Central ──────────────────────────────────────────────────────────────────
('pp-018',
 'Enclave at Village Walk',
 'Orlando, FL',
 'central',
 '["proposal/portfolio/enclave-at-village-walk.jpg"]',
 NULL, 150, 1),

('pp-019',
 'Oaks of Timacuan',
 'Lake Mary, FL',
 'central',
 '["proposal/portfolio/oaks-of-timacuan.jpg"]',
 NULL, 160, 1),

('pp-020',
 'Village Walk',
 'Orlando, FL',
 'central',
 '["proposal/portfolio/village-walk.jpg"]',
 NULL, 170, 1),

('pp-021',
 'Watermark',
 'Winter Garden, FL',
 'central',
 '["proposal/portfolio/watermark.jpg"]',
 NULL, 180, 1),

-- Filename typo: 'Cory Lakes Isles' (likely Cory Lake Isles — singular Lake).
('pp-022',
 'Cory Lakes Isles',
 'Tampa, FL',
 'central',
 '["proposal/portfolio/cory-lakes-isles.jpg"]',
 NULL, 190, 1),

-- Filename typo: 'Estencia at Wiregrass' (likely Estancia at Wiregrass).
('pp-023',
 'Estencia at Wiregrass',
 'Wesley Chapel, FL',
 'central',
 '["proposal/portfolio/estencia-at-wiregrass.jpg"]',
 NULL, 200, 1),

-- Filename typo: 'Heritages Isles' (Tampa) — distinct from Heritage Isles (Melbourne).
-- Page text sanity check failed: artwork uses embedded raster text (verified).
('pp-024',
 'Heritages Isles',
 'Tampa, FL',
 'central',
 '["proposal/portfolio/heritages-isles.jpg"]',
 NULL, 210, 1),

-- Hunter's Green: apostrophe slugified to 'hunter-s-green' by rasterizer.
('pp-025',
 'Hunter''s Green',
 'Wesley Chapel, FL',
 'central',
 '["proposal/portfolio/hunter-s-green.jpg"]',
 NULL, 220, 1),

('pp-026',
 'Starkey Ranch',
 'Tampa, FL',
 'central',
 '["proposal/portfolio/starkey-ranch.jpg"]',
 NULL, 230, 1),

('pp-027',
 'Villa Rosa',
 'Tampa, FL',
 'central',
 '["proposal/portfolio/villa-rosa.jpg"]',
 NULL, 240, 1)

ON DUPLICATE KEY UPDATE
    name                     = VALUES(name),
    city_state               = VALUES(city_state),
    region_id                = VALUES(region_id),
    photo_object_keys        = VALUES(photo_object_keys),
    before_after_object_keys = VALUES(before_after_object_keys),
    sort_order               = VALUES(sort_order),
    active                   = VALUES(active);
