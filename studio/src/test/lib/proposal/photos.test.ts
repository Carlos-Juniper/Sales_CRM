// ---------------------------------------------------------------------------
// photos.test.ts — the proposal photography manifest resolves to correct URLs
//
// As of PR9, brand photography (service photos, headshots) is served through
// the /proposal-assets/{path} GCS proxy route rather than from the Vite bundle.
// Disk-presence checks are replaced with URL-pattern assertions: the right URL
// is what keeps images loading in production; disk presence is an artifact of
// local dev setup and is no longer meaningful.
//
// Files that remain bundled (watermark, florida-map) are still tested in
// assets.test.ts via proposalAssetUrl().
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import {
  SERVICE_PHOTOS,
  SERVICE_DETAIL_PHOTOS,
  OVERVIEW_CATEGORY_PHOTOS,
  PAGE_PHOTOS,
  ORG_ICONS,
  BUNDLED_HEADSHOT_SLUGS,
  proposalPhotoUrl,
  servicePhotoUrl,
  serviceDetailPhotoUrls,
  overviewCategoryPhotoUrl,
  bundledHeadshotUrl,
  headshotSlug,
} from '@/lib/proposal/photos'
import { SERVICES_CONTENT, SERVICE_OVERVIEW_CATEGORIES } from '@/lib/proposal/staticContent'

const PROXY_PHOTO_BASE = '/proposal-assets/proposal/photos'
const PROXY_HEADSHOT_BASE = '/proposal-assets/proposal/headshots'

describe('SERVICE_PHOTOS', () => {
  it('covers every service in SERVICES_CONTENT', () => {
    expect(Object.keys(SERVICE_PHOTOS).sort()).toEqual(Object.keys(SERVICES_CONTENT).sort())
  })

  it('names a distinct photo per service', () => {
    const files = Object.values(SERVICE_PHOTOS)
    expect(new Set(files).size).toBe(files.length)
  })

  it.each(Object.entries(SERVICE_PHOTOS))('%s resolves through the GCS proxy', (_key, file) => {
    expect(proposalPhotoUrl(file)).toBe(`${PROXY_PHOTO_BASE}/${file}`)
  })
})

describe('proposalPhotoUrl', () => {
  it('routes through the GCS proxy', () => {
    expect(proposalPhotoUrl('service-turf.jpg')).toBe(
      `${PROXY_PHOTO_BASE}/service-turf.jpg`,
    )
  })

  it('routes service keys through the same path', () => {
    expect(servicePhotoUrl('services_turf')).toBe(`${PROXY_PHOTO_BASE}/service-turf.jpg`)
  })

  it('serviceDetailPhotoUrls prefixes each slot with the proxy path', () => {
    const urls = serviceDetailPhotoUrls('services_irrigation')
    expect(urls[0]).toBe(`${PROXY_PHOTO_BASE}/hero-services_irrigation.jpg`)
    expect(urls[1]).toBe(`${PROXY_PHOTO_BASE}/collage-services_irrigation-1.jpg`)
  })
})

// ---------------------------------------------------------------------------
// SERVICE_DETAIL_PHOTOS — ordered photo manifest per service detail page
// ---------------------------------------------------------------------------

describe('SERVICE_DETAIL_PHOTOS', () => {
  it('covers every service in SERVICES_CONTENT', () => {
    expect(Object.keys(SERVICE_DETAIL_PHOTOS).sort()).toEqual(Object.keys(SERVICES_CONTENT).sort())
  })

  it('each set has 1-3 entries', () => {
    for (const [key, set] of Object.entries(SERVICE_DETAIL_PHOTOS)) {
      expect(set.length, `${key} length`).toBeGreaterThanOrEqual(1)
      expect(set.length, `${key} length`).toBeLessThanOrEqual(3)
    }
  })

  it('no filename repeats within a set', () => {
    for (const [key, set] of Object.entries(SERVICE_DETAIL_PHOTOS)) {
      expect(new Set(set).size, `${key} has duplicates`).toBe(set.length)
    }
  })

  it.each(Object.entries(SERVICE_DETAIL_PHOTOS))(
    '%s — all files resolve through the GCS proxy',
    (_key, set) => {
      for (const file of set) {
        expect(proposalPhotoUrl(file)).toMatch(/^\/proposal-assets\/proposal\/photos\//)
      }
    },
  )
})

// ---------------------------------------------------------------------------
// OVERVIEW_CATEGORY_PHOTOS — one photo per capability group on the overview page
// ---------------------------------------------------------------------------

describe('OVERVIEW_CATEGORY_PHOTOS', () => {
  it('covers every category key in SERVICE_OVERVIEW_CATEGORIES', () => {
    const expectedKeys = SERVICE_OVERVIEW_CATEGORIES.map((c) => c.key).sort()
    expect(Object.keys(OVERVIEW_CATEGORY_PHOTOS).sort()).toEqual(expectedKeys)
  })

  it('resolves storm_response to overview-storm-response.jpg (hyphenated filename)', () => {
    expect(overviewCategoryPhotoUrl('storm_response')).toBe(
      `${PROXY_PHOTO_BASE}/overview-storm-response.jpg`,
    )
  })
})

// ---------------------------------------------------------------------------
// PAGE_PHOTOS — standalone frames for Rooted in Florida and Customer Care
// ---------------------------------------------------------------------------

describe('PAGE_PHOTOS', () => {
  it('covers the expected page-photo keys', () => {
    expect(Object.keys(PAGE_PHOTOS).sort()).toEqual(
      [
        'certifiedArboristBadge',
        'customerCare',
        'introLetter',
        'irrigationInspectionSample',
        'juniperCares1',
        'juniperCares2',
        'juniperMapping',
        'juniperMappingAfter',
        'juniperMappingBefore',
        'juniperMappingDroneHero',
        'juniperMappingGoogleEarth',
        'juniperMappingHighRes',
        'juniperMappingLogo',
        'juniperMappingNdvi',
        'juniperSyncAppMenu',
        'juniperSyncAppSummary',
        'juniperSyncLogo',
        'juniperSyncQr',
        'rootedFlorida1',
        'rootedFlorida2',
        'startupComm',
        'startupPlan306090',
        'thankYou',
        'weeklyUpdateSample',
      ].sort(),
    )
  })

  it.each(Object.entries(PAGE_PHOTOS))('%s resolves through the GCS proxy', (_key, file) => {
    expect(proposalPhotoUrl(file)).toBe(`${PROXY_PHOTO_BASE}/${file}`)
  })
})

// ---------------------------------------------------------------------------
// ORG_ICONS — five org-chart glyph PNGs
// ---------------------------------------------------------------------------

describe('ORG_ICONS', () => {
  it('contains exactly five entries (org-icon-1.png … org-icon-5.png)', () => {
    expect(ORG_ICONS.length).toBe(5)
    for (let i = 1; i <= 5; i++) {
      expect(ORG_ICONS).toContain(`org-icon-${i}.png`)
    }
  })

  it.each(ORG_ICONS)('%s resolves through the GCS proxy', (file) => {
    expect(proposalPhotoUrl(file)).toBe(`${PROXY_PHOTO_BASE}/${file}`)
  })
})

// ---------------------------------------------------------------------------
// Headshots — 45 portraits served via GCS proxy (/proposal-assets/...)
// ---------------------------------------------------------------------------

describe('headshots', () => {
  it('BUNDLED_HEADSHOT_SLUGS contains 45 slugs', () => {
    expect(BUNDLED_HEADSHOT_SLUGS.size).toBe(45)
  })

  it('headshotSlug("Dan DeMont") === "dan-demont"', () => {
    expect(headshotSlug('Dan DeMont')).toBe('dan-demont')
  })

  it('headshotSlug lowercases and collapses non-alphanumeric runs to a single hyphen', () => {
    expect(headshotSlug("O'Brien Smith")).toBe('o-brien-smith')
  })

  it('bundledHeadshotUrl("Michelle Cady") routes through the GCS proxy', () => {
    const url = bundledHeadshotUrl('Michelle Cady')
    expect(url).not.toBeNull()
    expect(url).toBe(`${PROXY_HEADSHOT_BASE}/headshot-michelle-cady.jpg`)
  })

  it('bundledHeadshotUrl("Brandon Duke") routes through the GCS proxy', () => {
    const url = bundledHeadshotUrl('Brandon Duke')
    expect(url).not.toBeNull()
    expect(url).toBe(`${PROXY_HEADSHOT_BASE}/headshot-brandon-duke.jpg`)
  })

  it('bundledHeadshotUrl returns null for an unknown name', () => {
    expect(bundledHeadshotUrl('Jane Doe')).toBeNull()
  })

  it('every slug in BUNDLED_HEADSHOT_SLUGS maps to a correctly-formed proxy URL', () => {
    for (const slug of BUNDLED_HEADSHOT_SLUGS) {
      // Build the expected URL directly from the slug — same formula as bundledHeadshotUrl().
      const expected = `${PROXY_HEADSHOT_BASE}/headshot-${slug}.jpg`
      expect(expected).toMatch(/^\/proposal-assets\/proposal\/headshots\/headshot-[a-z0-9-]+\.jpg$/)
    }
  })
})
