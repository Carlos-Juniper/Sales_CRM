-- Migration 082 — H59 Turf/catalog curation
--
-- Staging was seeded too broadly from the Aspire sample: Turf carried Base
-- Maintenance + Jan–Dec month rows (no kits), plus bid/summer extras. Carlos
-- wants Aspire-like estimating: Turf = Peak + Off-peak mowing with equipment
-- method kits; occurrences = visit count on the mowing service (not a row per
-- month). This migration deactivates the schedule-style / no-kit services so
-- they never appear in GET /service-catalog or add-service, and re-activates
-- the curated set. Auto-seed allowlist lives in api/maintenance_catalog.py.
--
-- Idempotent: re-running leaves the same active flags. No schema change.
-- Detector keys on Base Maintenance (maint-svc-50111) being inactive.

-- ── Turf: Base + 12 month schedule rows (no kits) ────────────────────────────
UPDATE services SET active = 0 WHERE id IN (
    'maint-svc-50111',  -- Base Maintenance
    'maint-svc-50150',  -- January Base Maintenance
    'maint-svc-50151',  -- February Base Maintenance
    'maint-svc-50152',  -- March Base Maintenance
    'maint-svc-50153',  -- April Base Maintenance
    'maint-svc-50154',  -- May Base Maintenance
    'maint-svc-50155',  -- June Base Maintenance
    'maint-svc-50156',  -- July Base Maintenance
    'maint-svc-50157',  -- August Base Maintenance
    'maint-svc-50158',  -- September Base Maintenance
    'maint-svc-50159',  -- October Base Maintenance
    'maint-svc-50160',  -- November Base Maintenance
    'maint-svc-50161'   -- December Base Maintenance
);

-- Turf: bid / add'l / summer schedule-style (not Peak/Off-peak mowing)
UPDATE services SET active = 0 WHERE id IN (
    'maint-svc-46821',  -- Additional Contract Service (no kits)
    'maint-svc-46814',  -- Bid Item #1 (no kits)
    'maint-svc-46817',  -- Bid Item #2 (no kits)
    'maint-svc-46837',  -- Bid Item #3 (no kits)
    'maint-svc-50241'   -- Summer Maintenance - RAM (not curated Turf)
);

-- Keep Peak + Off-peak active (equipment kits hang off these)
UPDATE services SET active = 1 WHERE id IN (
    'maint-svc-50390',  -- PEAK Mowing
    'maint-svc-50391'   -- OFF-PEAK Mowing
);

-- ── Bed Maint: keep Peak + Off-peak pruning; drop no-kit add'l ────────────────
UPDATE services SET active = 0 WHERE id = 'maint-svc-23819';  -- Additional Pruning #1
UPDATE services SET active = 1 WHERE id IN (
    'maint-svc-18906',  -- Pruning (Peak) — auto-seeded
    'maint-svc-50392'   -- Pruning OFF Peak — catalog only, not auto-seeded
);

-- ── Irrigation ───────────────────────────────────────────────────────────────
UPDATE services SET active = 1 WHERE id = 'maint-svc-18900';  -- Irrigation Wet Checks

-- ── Fertilizer: keep 8 quarters; deactivate sampled Aspire program rows ──────
UPDATE services SET active = 0 WHERE id IN (
    'maint-svc-23814',  -- Fertilization Program Turf & Shrubs
    'maint-svc-18893',  -- Fertilize Shrub (non-quarter)
    'maint-svc-30964',  -- Fertilize Turf (non-quarter)
    'maint-svc-23807',  -- Fertilize Turf Additional Application #1
    'maint-svc-50243'   -- Fertilize Turf Raleigh
);
UPDATE services SET active = 1 WHERE id IN (
    'maint-svc-fert-shrub-q1',
    'maint-svc-fert-shrub-q2',
    'maint-svc-fert-shrub-q3',
    'maint-svc-fert-shrub-q4',
    'maint-svc-fert-turf-q1',
    'maint-svc-fert-turf-q2',
    'maint-svc-fert-turf-q3',
    'maint-svc-fert-turf-q4'
);

-- ── Pest Control: keep Insect & Disease; drop no-kit schedule extras ─────────
UPDATE services SET active = 0 WHERE id IN (
    'maint-svc-50213',  -- Aeration
    'maint-svc-50148',  -- Agronomy Services
    'maint-svc-50199',  -- Insect and Disease Control Additional #2
    'maint-svc-50137'   -- Palm Injections
);
UPDATE services SET active = 1 WHERE id = 'maint-svc-18904';  -- Insect and Disease Control

-- ── Optional: drop no-kit / non-takeoff junk; keep real kit-backed optionals ──
UPDATE services SET active = 0 WHERE id IN (
    'maint-svc-23823',  -- Terms & Conditions
    'maint-svc-50168',  -- Drone Mapping
    'maint-svc-50167',  -- Juniper Sync Customer Service
    'maint-svc-18892',  -- Debris Removal
    'maint-svc-18907',  -- Warranty
    'maint-svc-50270',  -- Fall Seasonal Annuals (no kits)
    'maint-svc-50269',  -- Spring Seasonal Annuals (no kits)
    'maint-svc-50200',  -- Fire Ant Control Additional #1 (no kits)
    'maint-svc-50273',  -- Leaf Removal (no kits)
    'maint-svc-50400'   -- Spring/Fall Annual Treatments (no kits)
);
UPDATE services SET active = 1 WHERE id IN (
    'maint-svc-18902',  -- Mulch
    'maint-svc-19486',  -- Annual Flower Installation
    'maint-svc-46819',  -- Additional Irrigation Wet Check #1
    'maint-svc-21186',  -- Additional Pruning #5
    'maint-svc-50244',  -- Fertilize Shrubs Raleigh
    'maint-svc-50393',  -- Palm Pruning
    'maint-svc-50242'   -- Winter Maintenance
);
