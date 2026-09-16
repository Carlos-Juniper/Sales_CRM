-- ---------------------------------------------------------------------------
-- Migration 047 — Contract scope text, sourced from Pointe Jupiter Yacht Club
--
-- Migration 045's scope_text seed never actually applied: every UPDATE in it
-- filters on `service_type = 'maintenance'`, but service_type holds the
-- service CATEGORY ('Turf Area', 'Irrigation', 'Palm Pruning', ...) — no row
-- in catalog_items has the literal value 'maintenance'. The real flag for "is
-- this an active maintenance service" is `kit_type = 'maintenance_hours'`
-- (the other kit_type is 'install_quantity'). That bug is why the contract
-- chapter's scope narrative rendered blank even after 045 was applied.
--
-- This migration:
--   1. Re-seeds every UPDATE from 045 against the REAL catalog_items.description
--      values (verified against the live catalog — 045's patterns assumed
--      simplified names like 'Mowing & Edging' / 'Weed Control' that don't
--      exist; the real rows are Aspire-style kit names like 'Standard
--      Production Mowing' / 'Weed Eat' / 'Prune Medium').
--   2. Replaces the wording for every category with a direct counterpart in
--      the "Services" section of the real, signed Pointe Jupiter Yacht Club
--      Landscape Maintenance Agreement ("business docs/Pointe Jupiter Yacht
--      Club.pdf", pages 38-41), transcribed near-verbatim.
--   3. Leaves Mulch / Annual Flowers on 045's original generic wording (no
--      Pointe Jupiter counterpart — that document's Optional Services table
--      has no narrative paragraph for them) but fixes the same filter bug so
--      they at least populate.
--
-- Catalog items with no clear scope-of-work counterpart in the reference
-- (Drive Time, Additional Visits, Ponds, Fenced Backyards, Production Homes)
-- are intentionally left without scope_text — they're internal billing
-- categories, not client-facing services a contract would narrate.
--
-- Applied by scripts/migrate.py (idempotent UPDATEs, no custom detector).
-- ---------------------------------------------------------------------------

-- Mowing — "Mowing:" (p.38)
UPDATE catalog_items
   SET scope_text = 'Mowing shall be performed with commercial grade mower types and blades to provide a quality cut. Mower blades will be sharpened between each mowing to prevent tearing of grass blades. Mowing patterns shall be rotated to minimize scalping and rutting by mower wheels and to minimize soil compaction. Bahia & Saint Augustine Turf shall be mowed at a height of 3-4". Zoysia Turf will be mowed at 1.5-2". All turf shall be mowed weekly during the growing season of May through October and bi-weekly during the slow growing season of November through April. Should the association request additional cuts, a separate proposal can be provided at the time service is requested. Clippings shall be left on the lawn as long as no visible clumps remain on the grass surface 24 hours after mowing. Otherwise, Contractor will collect and dispose of clippings.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND (description LIKE '%Production Mowing%' OR description = 'Roadway & Lake Bank Mowing');

-- Edging (and "Weed Eat" string-trimming, which the reference folds into hard-
-- surface edging) — "Edging:" (p.38)
UPDATE catalog_items
   SET scope_text = 'All hard surfaces shall be edged at every mowing. All soft surfaces (landscape beds), shall be edged every other visit to maintain a clean edge.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND description IN ('Bed Edge', 'Hard Edge (Blowing Off Inc)', 'Weed Eat');

-- Debris Removal — "Debris Removal:" (p.38)
UPDATE catalog_items
   SET scope_text = 'Contractor shall be responsible for the removal of all lawn debris and visible clippings with each site visit and blowing off all walks, driveways, and street area where debris may be visible.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND description = 'Additional Blowing/Policing';

-- Bed Weed Control — "Bed Weed Control:" (p.38)
UPDATE catalog_items
   SET scope_text = 'All landscape bed areas where weeds are evident will be treated with herbicide to keep these areas relatively weed free. Large weeds will be pulled by hand so as not to be allowed to have enough established quality to detract from the overall aesthetics of the landscape.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND description = 'Additional Round Up';

-- Bed Area Maintenance — no direct Pointe Jupiter counterpart; keep 045's
-- original generic wording, just apply it under the corrected filter.
UPDATE catalog_items
   SET scope_text = 'Juniper will maintain all landscape beds by removing weeds, edging bed borders, and cultivating mulch or groundcover as needed. Beds will be kept neat and free of debris to showcase plant materials and maintain a professional appearance.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND description = 'Bed Area Maintenance';

-- Pruning (shrubs/hedges) — "Pruning:" (p.38)
UPDATE catalog_items
   SET scope_text = 'Pruning shall be performed to maintain the natural shape and plant palette characteristics. Pruning shall include, but not limited to, the removal of vegetation that is dead, damaged, or diseased. When diseased vegetation is removed, the pruning cuts shall be made deep into the healthy plant tissue to re-establish healthy growth. Should flat tops and sides be desired, this will be achieved by the use of gas-powered shears. Should the association request additional trims, an additional services proposal can be provided at the time service is requested. All trimming and pruning shall be subject to all applicable State, Federal, and ANSI (American National Standards Institute) regulations.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND description IN ('Prune Easy', 'Prune Medium', 'Prune Hard');

-- Trees — "Arbor (Below 12 FT): Trees" (p.38-39)
UPDATE catalog_items
   SET scope_text = 'Trees shall be pruned to remove any dead or damaged branches. This will include cross-branching and the raising of canopies to allow safe pedestrian movement on sidewalks and driveways in accordance to good canopy structure. Trees over 12 feet in overall height requiring service at canopies shall be performed at the Owner''s request and expense.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND description IN ('Tree Canopy Trimming', 'Tree Rings');

-- Palms — "Arbor (Below 12 FT): Palms" (p.39)
UPDATE catalog_items
   SET scope_text = 'Fronds shall be removed when frond tips are brown and or damaged with the clean edge cuts made as close to the trunk as possible. Careful trimming procedures shall be followed to prevent damage to any portion of the tree, especially in the crown shaft and bud area. Inflorescence or seedpods and fruit shall be removed on a set cycle. Palms over 12 feet in overall height requiring service at canopies shall be performed at Owner''s request and expense.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND service_type = 'Palm Pruning';

-- Fertilization — "Fertilization:" (p.39)
UPDATE catalog_items
   SET scope_text = 'Fertilizer services will be overseen by a manager with a Certified Pest Control Operator license. Fertilization will be performed by a technician who is BMP certified and holds a Limited Commercial Fertilizer License issued by the Florida Department of Agriculture and Consumer Services. All fertilizers utilized under this program will be a balanced nutrient package. Contractor will follow Green Industry Best Management Practices and all state and local fertilizer ordinances. Lawn & ornamentals shall be fertilized as warranted with a commercial fertilizer. The number of applications will be dependent on plant species, site conditions, and fertilizer blends used. Regardless of blends used, Contractor will apply, at a minimum, 4 pounds of nitrogen per 1000 square feet for turf. Ornamentals will vary by species and size. The application of Nitrogen (N) & Phosphorus (P) is prohibited in Florida from June 1st until September 30th. Changes in regulation, outside of Contractor''s control, may affect service.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND service_type = 'Fertilization & Pest Control';

-- Irrigation — "Irrigation: Wet Checks / Technician Adjustments" (p.39-40)
UPDATE catalog_items
   SET scope_text = 'Contractor shall perform a routine monthly maintenance inspection of the irrigation system for leaks, adjust and clean sprinkler heads where needed, and inspect control valves and valve boxes. Technician will adjust the controller to the watering needs and in accordance with state and local ordinances as dictated by site conditions. All parts needed to maintain functionality of the system will be proposed when exceeding $500.00. All repairs made under $500.00 will be scheduled as discovered, per this Contract. For all repairs in excess of $500.00, work will not commence until signed off by an authorized representative of the Owner.',
       billing_type = 'recurring'
 WHERE kit_type = 'maintenance_hours'
   AND service_type = 'Irrigation';

-- Mulch — no Pointe Jupiter narrative (it only appears in that document's
-- Optional Services table, with no accompanying paragraph); keep 045's
-- generic wording, corrected filter, one-time billing.
UPDATE catalog_items
   SET scope_text = 'Juniper will install premium mulch in all landscape beds to a depth of 2-3 inches. Mulch conserves soil moisture, suppresses weed growth, and provides a finished appearance. Existing mulch will be cultivated and refreshed prior to application, and all bed borders will be re-edged.',
       billing_type = 'one_time'
 WHERE kit_type = 'maintenance_hours'
   AND description IN ('Mulch Per Yard', 'Mulch Per Bag (3 CF)');

-- Annual Flowers — same rationale as Mulch above.
UPDATE catalog_items
   SET scope_text = 'Juniper will install seasonal annual flowers in designated beds and planters. Plant material will be selected for color, bloom time, and performance in the local climate. Beds will be prepared with soil amendments as needed, and all installations will be watered-in upon completion.',
       billing_type = 'one_time'
 WHERE kit_type = 'maintenance_hours'
   AND description = 'Number of Flowers per Change Out';

-- ── Coverage report ──────────────────────────────────────────────────────────

SELECT
    COUNT(*) AS total_active_maintenance_kits,
    SUM(CASE WHEN scope_text IS NOT NULL THEN 1 ELSE 0 END) AS kits_with_scope_text,
    SUM(CASE WHEN scope_text IS NULL THEN 1 ELSE 0 END) AS kits_without_scope_text
FROM catalog_items
WHERE kit_type = 'maintenance_hours' AND active = 1;
