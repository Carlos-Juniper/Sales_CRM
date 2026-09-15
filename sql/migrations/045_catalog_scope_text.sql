-- ---------------------------------------------------------------------------
-- Migration 045 — Catalog scope text seed (Contract Generator, Slice 2)
--
-- Seeds scope_text and billing_type for maintenance catalog items from the
-- four Aspire reference exports (Coral Bay, Pointe Jupiter, Hyatt Place,
-- East County Middle School). Text is harvested verbatim from those PDFs.
--
-- Mowing season canonical wording: "March through October / November through
-- February" (selected over the May-October variant).
--
-- Applied by scripts/migrate.py (no custom detector needed — idempotent UPDATEs).
-- ---------------------------------------------------------------------------

-- ── 1. Core maintenance services ─────────────────────────────────────────────

-- Mowing & Edging
UPDATE catalog_items
   SET scope_text = 'Juniper will mow all turf areas on the property from March through October. During the months of November through February, mowing will be performed on an as-needed basis to maintain a neat and professional appearance. All mowing will be performed with commercial-grade equipment, and clippings will be dispersed evenly to promote a healthy turf. String trimming and edging will be performed around all hardscape, landscape beds, and other obstacles to provide a clean, finished appearance.',
       billing_type = 'recurring'
 WHERE description = 'Mowing & Edging'
   AND service_type = 'maintenance';

-- Line Trimming
UPDATE catalog_items
   SET scope_text = 'Juniper will perform line trimming around all buildings, fences, landscape beds, and other obstacles that cannot be reached by mowing equipment. This service ensures a clean, professional edge along all hardscape and landscape features.',
       billing_type = 'recurring'
 WHERE description = 'Line Trimming'
   AND service_type = 'maintenance';

-- Edging
UPDATE catalog_items
   SET scope_text = 'Juniper will edge all sidewalks, curbs, driveways, and other hardscape borders to maintain a crisp, clean appearance. Edging will be performed with commercial-grade equipment, and debris will be blown clear of all paved surfaces.',
       billing_type = 'recurring'
 WHERE description = 'Edging'
   AND service_type = 'maintenance';

-- Blowing
UPDATE catalog_items
   SET scope_text = 'Juniper will blow all paved surfaces, including sidewalks, driveways, parking lots, and building entrances, to remove grass clippings, leaves, and other debris. This service is performed after every mowing visit to ensure a clean, finished appearance.',
       billing_type = 'recurring'
 WHERE description = 'Blowing'
   AND service_type = 'maintenance';

-- Landscape Bed Maintenance
UPDATE catalog_items
   SET scope_text = 'Juniper will maintain all landscape beds by removing weeds, edging bed borders, and cultivating mulch or groundcover as needed. Beds will be kept neat and free of debris to showcase plant materials and maintain a professional appearance.',
       billing_type = 'recurring'
 WHERE description LIKE '%Landscape Bed%'
   AND service_type = 'maintenance';

-- ── 2. Plant care ────────────────────────────────────────────────────────────

-- Shrub & Hedge Trimming
UPDATE catalog_items
   SET scope_text = 'Juniper will prune and shape all shrubs and hedges to maintain their natural form, promote healthy growth, and ensure proper clearance from buildings and walkways. Pruning will be performed by trained technicians using industry best practices, and all debris will be removed from the property.',
       billing_type = 'recurring'
 WHERE description LIKE '%Shrub%Trimming%'
    OR description LIKE '%Hedge%Trimming%'
   AND service_type = 'maintenance';

-- Tree Trimming
UPDATE catalog_items
   SET scope_text = 'Juniper will trim and maintain trees to ensure proper clearance from buildings, walkways, and overhead utilities. Trimming will focus on removing dead or damaged branches, shaping for aesthetics, and promoting healthy growth. All work will be performed by trained arborists in accordance with ANSI A300 standards.',
       billing_type = 'recurring'
 WHERE description LIKE '%Tree%Trimming%'
   AND service_type = 'maintenance';

-- ── 3. Seasonal & enhancement services ───────────────────────────────────────

-- Mulch Application
UPDATE catalog_items
   SET scope_text = 'Juniper will install premium mulch in all landscape beds to a depth of 2-3 inches. Mulch conserves soil moisture, suppresses weed growth, and provides a finished appearance. Existing mulch will be cultivated and refreshed prior to application, and all bed borders will be re-edged.',
       billing_type = 'one_time'
 WHERE description LIKE '%Mulch%'
   AND service_type = 'maintenance';

-- Annual Flower Installation
UPDATE catalog_items
   SET scope_text = 'Juniper will install seasonal annual flowers in designated beds and planters. Plant material will be selected for color, bloom time, and performance in the local climate. Beds will be prepared with soil amendments as needed, and all installations will be watered-in upon completion.',
       billing_type = 'one_time'
 WHERE description LIKE '%Annual%Flower%'
    OR description LIKE '%Color%Installation%'
   AND service_type = 'maintenance';

-- Irrigation System Maintenance
UPDATE catalog_items
   SET scope_text = 'Juniper will inspect and maintain the irrigation system to ensure proper operation and efficient water use. Services include adjusting spray heads, repairing leaks, replacing broken components, and programming controllers for optimal watering schedules. Monthly walk-throughs will identify issues before they impact plant health.',
       billing_type = 'recurring'
 WHERE description LIKE '%Irrigation%'
   AND service_type = 'maintenance';

-- Fertilization
UPDATE catalog_items
   SET scope_text = 'Juniper will apply a balanced, slow-release fertilizer to all turf areas to promote healthy, vigorous growth and a rich green color. Applications will be timed to align with the growing season and will be performed by licensed applicators in accordance with state regulations.',
       billing_type = 'recurring'
 WHERE description LIKE '%Fertili%'
   AND service_type = 'maintenance';

-- Weed Control
UPDATE catalog_items
   SET scope_text = 'Juniper will apply pre-emergent and post-emergent herbicides to control weeds in turf and landscape beds. Applications will be performed by licensed technicians using EPA-approved products, and all work will comply with state and local regulations.',
       billing_type = 'recurring'
 WHERE description LIKE '%Weed%Control%'
   AND service_type = 'maintenance';

-- Pest Control
UPDATE catalog_items
   SET scope_text = 'Juniper will monitor for and treat common landscape pests, including insects, fungi, and diseases. Treatments will be applied by licensed technicians using integrated pest management (IPM) principles to minimize environmental impact while protecting plant health.',
       billing_type = 'recurring'
 WHERE description LIKE '%Pest%Control%'
   AND service_type = 'maintenance';

-- ── 4. Specialty services ────────────────────────────────────────────────────

-- Leaf Removal
UPDATE catalog_items
   SET scope_text = 'Juniper will remove fallen leaves from all turf areas, landscape beds, and paved surfaces during the fall and winter months. Leaves will be collected, hauled away, and disposed of off-site to maintain a clean, professional appearance.',
       billing_type = 'recurring'
 WHERE description LIKE '%Leaf%Removal%'
   AND service_type = 'maintenance';

-- Pine Straw Installation
UPDATE catalog_items
   SET scope_text = 'Juniper will install long-needle pine straw in all landscape beds to a depth of 3-4 inches. Pine straw provides excellent weed suppression, moisture retention, and a natural, finished appearance. Existing straw will be refreshed and redistributed prior to new application.',
       billing_type = 'one_time'
 WHERE description LIKE '%Pine%Straw%'
   AND service_type = 'maintenance';

-- ── 5. Coverage report ───────────────────────────────────────────────────────
-- Emit a summary showing which active maintenance kits received scope_text.

SELECT 
    COUNT(*) AS total_active_maintenance_kits,
    SUM(CASE WHEN scope_text IS NOT NULL THEN 1 ELSE 0 END) AS kits_with_scope_text,
    SUM(CASE WHEN scope_text IS NULL THEN 1 ELSE 0 END) AS kits_without_scope_text
FROM catalog_items
WHERE service_type = 'maintenance' AND active = 1;

-- List any active maintenance kits that did not receive scope_text (for manual review)
SELECT id, description, kit_type, aspire_branch_id
FROM catalog_items
WHERE service_type = 'maintenance'
  AND active = 1
  AND scope_text IS NULL
ORDER BY description;
