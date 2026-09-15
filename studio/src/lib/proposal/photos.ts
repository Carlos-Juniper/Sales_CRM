// ---------------------------------------------------------------------------
// Proposal brand photography.
//
// Distinct from lib/proposal/assets.ts, which exists for the narrow problem of
// CSS background-image fetches the readiness gate cannot see. Everything here
// renders as a real <img> inside #proposal-preview, so ProposalPrintRoute's
// querySelectorAll('img') sweep already blocks the capture on it — no preload
// list to keep in sync.
//
// Also distinct from the headshot / portfolio path (useProposalMediaUrl →
// /api/proposals/config/media-url → signed GCS URL). Those are per-config
// assets a rep uploads. These are fixed brand photography: the same ten frames
// on every proposal Juniper sends, with no database row behind them.
//
// Where the bytes live is a deploy-time choice, not a code change — see
// PROPOSAL_ASSET_BASE below.
// ---------------------------------------------------------------------------

import { SERVICES_CONTENT, SERVICE_OVERVIEW_CATEGORIES } from './staticContent'

type ServiceKey = keyof typeof SERVICES_CONTENT

/** The stable `key` ids on the six service-overview categories. */
type OverviewCategoryKey = (typeof SERVICE_OVERVIEW_CATEGORIES)[number]['key']

/**
/** Resolve a filename under proposal/photos/ to a loadable URL (served via GCS proxy). */
export function proposalPhotoUrl(file: string): string {
  return `/proposal-assets/proposal/photos/${file}`
}

/**
 * One frame per service, for the badge-overlapped cards on the "What We Do"
 * grid. Curated from the Coral Bay HOA reference proposal; the source page and
 * xref of each is kept here because the extraction dump is not in the repo and
 * these are otherwise unidentifiable 1344px JPEGs.
 *
 * Every ServiceKey must be present. The grid renders whatever SERVICE_KEYS
 * lists, and a missing entry there would be a broken <img> on a page the rep
 * cannot edit — Record<ServiceKey, string> makes that a compile error instead.
 */
export const SERVICE_PHOTOS: Record<ServiceKey, string> = {
  services_design: 'service-design.jpg', //           p07 x86  — plan markup
  services_maintenance: 'service-maintenance.jpg', // p09 x106 — lakeside mowing
  services_installation: 'service-installation.jpg', // p10 x113 — crew planting
  services_turf: 'service-turf.jpg', //               p07 x88  — striped turf
  services_irrigation: 'service-irrigation.jpg', //   p11 x118 — head adjustment
  services_arboriculture: 'service-arboriculture.jpg', // p12 x123 — stump grinding
  services_storm_response: 'service-storm-response.jpg', // p17 x153 — grapple truck
  services_enhancements: 'service-enhancements.jpg', // p14 x134 — annual beds
  services_aquatics: 'service-aquatics.jpg', //       p07 x91  — aquatic harvester
  services_safety_training: 'service-safety-training.jpg', // p16 x146 — safety briefing
}

/** URL for a service card's photo. */
export function servicePhotoUrl(key: ServiceKey): string {
  return proposalPhotoUrl(SERVICE_PHOTOS[key])
}

// ---------------------------------------------------------------------------
// Service detail page photo manifest — one ordered photo set per service.
//
// Replaces the previous SERVICE_HERO_PHOTOS / SERVICE_SUPPORT_PHOTOS_2 /
// SERVICE_PHOTOS_ARE_DUPLICATE trio with a single ordered manifest. Slot order
// is render order for the service detail page collage:
//   Slot 1 — always rendered (typically the hero/primary frame)
//   Slot 2 — optional second frame
//   Slot 3 — optional third frame
//
// Collage shape semantics (documented here, applied in the renderer):
//   hero-row2 shape:  slot 1 spans the top row full-width, slots 2+3 form the bottom row
//   l-left shape:     slot 1 spans the left column full-height, slots 2+3 stack on right
//   split-tall shape: slots 1+2 are on left, slot 3 spans right column full-height
// ---------------------------------------------------------------------------

export type ServicePhotoSet =
  | readonly [string]
  | readonly [string, string]
  | readonly [string, string, string]

export const SERVICE_DETAIL_PHOTOS: Record<ServiceKey, ServicePhotoSet> = {
  services_design: ['service-design.jpg', 'hero-services_design.jpg', 'service-design-cad-plan.png'],
  services_maintenance: ['hero-services_maintenance.jpg', 'collage-services_maintenance-1.jpg', 'collage-services_maintenance-2.jpg'],
  services_installation: ['hero-services_installation.jpg', 'collage-services_installation-1.jpg', 'collage-services_installation-tall.jpg'],
  services_turf: ['collage-services_turf-1.jpg', 'collage-services_turf-2.jpg', 'hero-services_turf.jpg'],
  services_irrigation: ['hero-services_irrigation.jpg', 'collage-services_irrigation-1.jpg'],
  services_arboriculture: ['hero-services_arboriculture.jpg'],
  services_storm_response: ['hero-services_storm_response.jpg'],
  services_enhancements: ['service-enhancements.jpg', 'hero-services_enhancements.jpg', 'collage-services_enhancements-1.jpg'],
  services_aquatics: ['hero-services_aquatics.jpg'],
  services_safety_training: ['hero-services_safety_training.jpg'],
}

/** URLs for a service detail page's photo collage, in render order. */
export function serviceDetailPhotoUrls(key: ServiceKey): string[] {
  return SERVICE_DETAIL_PHOTOS[key].map(proposalPhotoUrl)
}

// ---------------------------------------------------------------------------
// Service overview category photos — one frame per capability group.
//
// Keyed to the stable `key` ids on SERVICE_OVERVIEW_CATEGORIES (staticContent),
// so the overview page can map over that list and wire a photo per category.
// Note the storm_response key hyphenates in the filename (overview-storm-
// response.jpg) to match how the imagery agent named the file on disk. Curated
// from the two reference proposals.
//
// Record<OverviewCategoryKey, string> makes every category's photo mandatory —
// a new category added to SERVICE_OVERVIEW_CATEGORIES becomes a compile error
// here until its frame is wired.
// ---------------------------------------------------------------------------
export const OVERVIEW_CATEGORY_PHOTOS: Record<OverviewCategoryKey, string> = {
  design: 'overview-design.jpg',
  build: 'overview-build.jpg',
  maintain: 'overview-maintain.jpg',
  technology: 'overview-technology.jpg',
  storm_response: 'overview-storm-response.jpg',
  aquatics: 'overview-aquatics.jpg',
}

/** URL for an overview capability group's photo. */
export function overviewCategoryPhotoUrl(key: OverviewCategoryKey): string {
  return proposalPhotoUrl(OVERVIEW_CATEGORY_PHOTOS[key])
}

// ---------------------------------------------------------------------------
// Standalone page photos — one-off frames that back a single page each and
// belong to no set. Referenced by name rather than mapped over, so a plain
// object of stable prop-style ids is cleaner than a Record. Curated from the
// two reference proposals: two "Rooted in Florida" (About Us) frames and the
// Customer Care portrait.
//
// F4 bare-page imagery (research-agent recommendations, 2026-09-09):
//   juniperCares1/2   — the real Juniper Cares photos (ribbon-cutting + bike
//                       giveaway), not a proxy; see PAGE_PHOTOS below
//   startupComm       — safety training = crew together in a structured, instructional setting
//   customerCare      — the only explicit customer-facing portrait (already wired)
//   juniperMapping    — design = site plans / spatial analysis, closest proxy for mapping
//   thankYou          — sweeping maintained Florida landscape, ideal closing image
//
// Juniper Sync's three images (below) are NOT proxies — they are the actual
// Juniper Sync page assets, extracted directly from "business docs/Coral Bay
// HOA.pdf" page 32 (xrefs 222/223/225) via scripts/extract_proposal_imagery.py's
// dump at extracted_images/coral_bay_hoa/. The prior `juniperSync:
// 'overview-technology.jpg'` entry was a mismatched stock photo standing in
// until these were wired (Handoff 52 follow-up).
// ---------------------------------------------------------------------------
export const PAGE_PHOTOS = {
  introLetter: 'intro-letter.jpg',
  rootedFlorida1: 'rooted-1.jpg',
  rootedFlorida2: 'rooted-2.jpg',
  customerCare: 'customer-care.jpg',
  // The actual Juniper Cares page photos (ribbon-cutting for the employee
  // "Forever Home" and the kids'-bike community giveaway) — pulled from p39 of
  // Coral Bay HOA / p17 of Pointe Jupiter, both proposals carry the same pair.
  juniperCares1: 'juniper-cares-ribbon-cutting.jpg',
  juniperCares2: 'juniper-cares-bikes.jpg',
  startupComm: 'hero-services_safety_training.jpg',
  // Juniper Sync product wordmark (leaf mark + "SYNC"), printed opposite the
  // page title — the reference's actual page-head art, not the generic
  // JuniperLeaves company mark other static pages use.
  juniperSyncLogo: 'juniper-sync-logo.png',
  // Scans to the real junipersync.com tour link — Carlos supplied the actual
  // encoded QR graphic, so this is no longer the fabricated-image gap noted
  // on StaticPageCopy.sidebarNote.
  juniperSyncQr: 'juniper-sync-qr.png',
  // The two app screenshots from the reference's Work Order System section.
  juniperSyncAppSummary: 'juniper-sync-app-summary.png',
  juniperSyncAppMenu: 'juniper-sync-app-menu.png',
  // ISA Certified Arborist badge — printed beside the "Certified Arborists"
  // subhead on the Arboriculture service page (services_arboriculture only).
  certifiedArboristBadge: 'certified-arborist-badge.jpg',
  juniperMapping: 'hero-services_design.jpg',
  thankYou: 'hero-services_maintenance.jpg',
  // Juniper Mapping product wordmark (pin mark + "MAPPING"), printed opposite
  // the title on both Juniper Mapping pages — extracted directly from
  // "business docs/Coral Bay HOA.pdf" p33 xref 231 (the page's own logo art,
  // not the generic JuniperLeaves company mark other static pages use).
  juniperMappingLogo: 'juniper-mapping-logo.png',
  // "Technology That Makes a Difference" page imagery, both extracted from
  // Coral Bay HOA.pdf p33 (xrefs 233, 232): the small aerial hero next to the
  // "Plant Health Assessment" copy, and the full-bleed NDVI-style health map
  // with its "Turf Areas of Concern" callout at the bottom of the page.
  juniperMappingDroneHero: 'juniper-mapping-drone-hero.jpg',
  juniperMappingNdvi: 'juniper-mapping-ndvi.jpg',
  // "Valuable Tools" page imagery, extracted from Coral Bay HOA.pdf p34
  // (xrefs 238, 240, 239, 241): the Image Quality Comparison pair (a
  // low-resolution Google Earth capture vs. Juniper Mapping's own high-res
  // orthomosaic of the same property) and the Track Improvements Side-By-Side
  // pair (the same pond before and after landscape work).
  juniperMappingGoogleEarth: 'juniper-mapping-google-earth.jpg',
  juniperMappingHighRes: 'juniper-mapping-highres.jpg',
  juniperMappingBefore: 'juniper-mapping-before.jpg',
  juniperMappingAfter: 'juniper-mapping-after.jpg',
  // 30-60-90 Day Start Up Plan hero. Coral Bay/Pointe Jupiter carry no such
  // page (the reference for this page is "30-60-90 plan example.pdf", a
  // separate generic doc with no extractable brand photography of its own),
  // so this reuses the bundled maintenance hero — a crew member on a
  // landscaped path beside community homes, the same kind of shot as the
  // reference's own hero.
  startupPlan306090: 'hero-services_maintenance.jpg',
  // The two sample report screenshots for the Irrigation Reporting Sample
  // page, extracted directly from a real (redacted) Beach Life Community
  // proposal — "Weekly updates and irrigation.pdf" p2, xrefs 8 and 10.
  irrigationInspectionSample: 'irrigation-inspection-report-sample.png',
  weeklyUpdateSample: 'weekly-landscaping-update-sample.png',
} as const

/**
 * URL for a standalone page photo. Callers can equally use
 * proposalPhotoUrl(PAGE_PHOTOS.customerCare); this exists so the two-step
 * lookup reads the same as the other resolvers at the call site.
 */
export function pagePhotoUrl(key: keyof typeof PAGE_PHOTOS): string {
  return proposalPhotoUrl(PAGE_PHOTOS[key])
}

// ---------------------------------------------------------------------------
// Org-chart icons — flattened circular badges (brand-colored fill + white
// glyph) for the account team org chart. org-icon-2.png is the green
// single-person badge (individual-role nodes) and org-icon-5.png is the
// orange group badge (crew rows). Bundled PNGs, mirrored into
// studio/public/proposal/photos.
// ---------------------------------------------------------------------------
export const ORG_ICONS = [
  'org-icon-1.png',
  'org-icon-2.png',
  'org-icon-3.png',
  'org-icon-4.png',
  'org-icon-5.png',
] as const

/** URL for an org-chart icon PNG (pass one of ORG_ICONS). */
export function orgIconUrl(file: (typeof ORG_ICONS)[number]): string {
  return proposalPhotoUrl(file)
}

// ---------------------------------------------------------------------------
// Bundled headshots — fixed brand portraits (490×654) for leadership/account
// team members who ship on every proposal. This is the fallback the headshot
// component reaches for AFTER an uploaded objectKey misses: a rep-uploaded
// portrait (useProposalMediaUrl → signed GCS URL) wins, and if there is none we
// slugify the person's name and see if we bundled a frame for them.
//
// Slug rule: lowercase the full name, then collapse every run of non-
// alphanumeric characters into a single hyphen. Files land in
// studio/public/proposal/photos as headshot-<slug>.jpg.
// ---------------------------------------------------------------------------

/** Slugify a full name: lowercase, non-alphanumeric runs → single hyphen. */
export function headshotSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The headshot slugs we have bundled portraits for.
 *
 * Original nine shipped with the Handoff-46 fidelity pass.
 * Additional slugs added when headshots are processed by normalize_headshots.py
 * Run: python scripts/normalize_headshots.py --dry-run to see the full list
 */
export const BUNDLED_HEADSHOT_SLUGS: ReadonlySet<string> = new Set([
  // Original nine (shipped with Handoff-46 fidelity pass)
  'brandon-duke',
  'dan-demont',
  'jake-rubin',
  'kyle-mcnamara',
  'michelle-cady',
  'josh-burton',
  'angela-girgado',
  'kyle-leverette',
  'alberto-toucet',
  // Added via normalize_headshots.py (W5c batch — root level)
  'rodrigo-leon',         // renamed from "Rod Leon" — W2 migration corrects DB name to "Rodrigo Leon"
  'bill-conrad',
  'brennen-garrett',
  'bret-wolf',
  'brian-calkins',
  'deidra-calloway',      // renamed from "Diedra Calloway" — corrected spelling to match DB
  'jessica-shannon',
  'michael-larsen',
  'scott-carlson',
  'tony-gartner',
  // Added via normalize_headshots.py (W5c batch — CRMs/)
  'annemarie-quinones',
  'eileen-grum',
  'eric-brown',
  'jerei-ellen-parks',
  'joe-bennett',
  'scott-mcleod',
  'susan-chapman',
  'tiffany-spring',
  // Added via normalize_headshots.py (W5c batch — Branch Managers/)
  'anthony-scappatura-venice',
  'catarino-martinez-naples',
  'diego-cantu-bradenton',
  'eddie-tanguay-venice',
  'frank-magana-vero-beach',
  'garth-rinard-tampa-east',
  'juan-nova-tampa-south',
  'keith-kirchoffer-ocala',
  'keith-scappatura',
  'matt-dean-south-orlando',
  'matt-hammond-bonita-springs',
  'matthew-gerich-tampa-north',
  'ricardo-peraza',
  'robert-benavidez-central-orlando',
  'stan-darna-tampa-north-install',
  'todd-ruggles-bradenton',
  'tom-jacob',
  'scott-skowron-naples',
])

/**
 * Resolve a bundled headshot URL for a name, or null if we did not bundle one.
 * Null (not a broken <img>) is the signal for the component to fall through to
 * its initials/placeholder rendering.
 */
export function bundledHeadshotUrl(name: string): string | null {
  const slug = headshotSlug(name)
  return BUNDLED_HEADSHOT_SLUGS.has(slug)
    ? `/proposal-assets/proposal/headshots/headshot-${slug}.jpg`
    : null
}
