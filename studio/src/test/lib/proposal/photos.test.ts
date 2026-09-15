// ---------------------------------------------------------------------------
// photos.test.ts — the proposal photography manifest resolves to real files
//
// Record<ServiceKey, string> already makes a MISSING service a compile error.
// What it cannot catch is a filename that does not exist: a typo, a photo
// renamed during a re-cut, or an entry added before the asset was committed.
// Any of those ships a proposal page with a hole in it, and the failure is
// silent — .photo's hatch fallback means it degrades to a tonal block rather
// than anything a reviewer would notice at a glance.
//
// So the assertion is against the filesystem, not the manifest's own shape.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
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

/** Mirrors PROPOSAL_ASSET_BASE's `${base}/proposal/photos/${file}` layout. */
const PHOTO_DIR = path.resolve(__dirname, '../../../../public/proposal/photos')

/** Headshots now live in their own directory separate from brand photography. */
const HEADSHOT_DIR = path.resolve(__dirname, '../../../../public/proposal/headshots')

describe('SERVICE_PHOTOS', () => {
  it('covers every service in SERVICES_CONTENT', () => {
    expect(Object.keys(SERVICE_PHOTOS).sort()).toEqual(Object.keys(SERVICES_CONTENT).sort())
  })

  it.each(Object.entries(SERVICE_PHOTOS))('%s → %s exists on disk', (_key, file) => {
    expect(existsSync(path.join(PHOTO_DIR, file))).toBe(true)
  })

  it('names a distinct photo per service', () => {
    const files = Object.values(SERVICE_PHOTOS)
    expect(new Set(files).size).toBe(files.length)
  })
})

describe('proposalPhotoUrl', () => {
  // VITE_PROPOSAL_ASSET_BASE is unset under vitest, which is the same-origin
  // case local dev and the current deploys run. The bucket case only changes
  // the prefix, so asserting the suffix keeps this true in both.
  it('resolves same-origin when no asset base is configured', () => {
    expect(proposalPhotoUrl('service-turf.jpg')).toBe('/proposal/photos/service-turf.jpg')
  })

  it('routes service keys through the same path', () => {
    expect(servicePhotoUrl('services_turf')).toBe('/proposal/photos/service-turf.jpg')
  })

  it('serviceDetailPhotoUrls prefixes each slot with the photo path', () => {
    const urls = serviceDetailPhotoUrls('services_irrigation')
    expect(urls[0]).toBe('/proposal/photos/hero-services_irrigation.jpg')
    expect(urls[1]).toBe('/proposal/photos/collage-services_irrigation-1.jpg')
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

  it.each(Object.entries(SERVICE_DETAIL_PHOTOS))(
    '%s — all files exist on disk',
    (_key, set) => {
      for (const file of set) {
        expect(existsSync(path.join(PHOTO_DIR, file)), file).toBe(true)
      }
    }
  )

  it('no filename repeats within a set', () => {
    for (const [key, set] of Object.entries(SERVICE_DETAIL_PHOTOS)) {
      expect(new Set(set).size, `${key} has duplicates`).toBe(set.length)
    }
  })
})

// ---------------------------------------------------------------------------
// OVERVIEW_CATEGORY_PHOTOS — one photo per capability group on the overview page
// ---------------------------------------------------------------------------

describe('OVERVIEW_CATEGORY_PHOTOS', () => {
  it('covers every category key in SERVICE_OVERVIEW_CATEGORIES', () => {
    const expectedKeys = SERVICE_OVERVIEW_CATEGORIES.map((c) => c.key).sort()
    expect(Object.keys(OVERVIEW_CATEGORY_PHOTOS).sort()).toEqual(expectedKeys)
  })

  it.each(Object.entries(OVERVIEW_CATEGORY_PHOTOS))('%s → %s exists on disk', (_key, file) => {
    expect(existsSync(path.join(PHOTO_DIR, file))).toBe(true)
  })

  it('resolves storm_response to overview-storm-response.jpg (hyphenated filename)', () => {
    // The underscore key hyphenates in the filename — easy to get wrong.
    expect(overviewCategoryPhotoUrl('storm_response')).toBe(
      '/proposal/photos/overview-storm-response.jpg',
    )
  })
})

// ---------------------------------------------------------------------------
// PAGE_PHOTOS — standalone frames for Rooted in Florida and Customer Care
// ---------------------------------------------------------------------------

describe('PAGE_PHOTOS', () => {
  it.each(Object.entries(PAGE_PHOTOS))('%s → %s exists on disk', (_key, file) => {
    expect(existsSync(path.join(PHOTO_DIR, file))).toBe(true)
  })

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
})

// ---------------------------------------------------------------------------
// ORG_ICONS — five org-chart glyph PNGs
// ---------------------------------------------------------------------------

describe('ORG_ICONS', () => {
  it.each(ORG_ICONS)('%s exists on disk', (file) => {
    expect(existsSync(path.join(PHOTO_DIR, file))).toBe(true)
  })

  it('contains exactly five entries (org-icon-1.png … org-icon-5.png)', () => {
    expect(ORG_ICONS.length).toBe(5)
    for (let i = 1; i <= 5; i++) {
      expect(ORG_ICONS).toContain(`org-icon-${i}.png`)
    }
  })
})

// ---------------------------------------------------------------------------
// Bundled headshots — 45 portraits served from public/proposal/headshots/
// ---------------------------------------------------------------------------

describe('bundled headshots', () => {
  it('BUNDLED_HEADSHOT_SLUGS contains 45 slugs', () => {
    expect(BUNDLED_HEADSHOT_SLUGS.size).toBe(45)
  })

  it.each([...BUNDLED_HEADSHOT_SLUGS])('headshot-%s.jpg exists on disk', (slug) => {
    expect(existsSync(path.join(HEADSHOT_DIR, `headshot-${slug}.jpg`))).toBe(true)
  })

  it('headshotSlug("Dan DeMont") === "dan-demont"', () => {
    expect(headshotSlug('Dan DeMont')).toBe('dan-demont')
  })

  it('headshotSlug lowercases and collapses non-alphanumeric runs to a single hyphen', () => {
    // Multi-word with apostrophe — edge case for the collapse rule.
    expect(headshotSlug("O'Brien Smith")).toBe('o-brien-smith')
  })

  it('bundledHeadshotUrl("Michelle Cady") returns the correct filename', () => {
    const url = bundledHeadshotUrl('Michelle Cady')
    expect(url).not.toBeNull()
    expect(url).toContain('headshot-michelle-cady.jpg')
  })

  it('bundledHeadshotUrl("Brandon Duke") returns a non-null url', () => {
    const url = bundledHeadshotUrl('Brandon Duke')
    expect(url).not.toBeNull()
    expect(url).toContain('headshot-brandon-duke.jpg')
  })

  it('bundledHeadshotUrl returns null for an unknown name', () => {
    expect(bundledHeadshotUrl('Jane Doe')).toBeNull()
  })
})
