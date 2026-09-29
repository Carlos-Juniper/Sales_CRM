import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import { sellRateCentsPer1000Sf } from '@/lib/estimating/maintenance'
import {
  CREW_RATE_ERROR_MESSAGES,
  CREW_RATE_REQUIRED_CODE,
  isCrewRateBlockedLine,
  isCrewRateDerivedLine,
  messageForErrorCode,
  parseCrewRateRequiredError,
  unsavedCrewRateDerivedLines,
  type CrewRateKitPrice,
} from '@/lib/estimating/crewRateError'

const PYTHON_SENTENCE =
  "Maintenance pricing is blocked: no crew rate is set for this estimate's branch. " +
  'Set it in Settings → Branch → Crew rate before saving priced maintenance lines.'

describe('crew-rate error wording', () => {
  it('owns the user-facing sentence in one map keyed by error code', () => {
    expect(messageForErrorCode(CREW_RATE_REQUIRED_CODE)).toBe(
      CREW_RATE_ERROR_MESSAGES[CREW_RATE_REQUIRED_CODE],
    )
    expect(messageForErrorCode(CREW_RATE_REQUIRED_CODE)).not.toBe(PYTHON_SENTENCE)
    expect(messageForErrorCode('unknown_code')).toBeNull()
  })
})

describe('parseCrewRateRequiredError', () => {
  it('reads the structured 422 and the blocked line ids', () => {
    const err = new ApiError(422, 'Unprocessable Entity', [], {
      code: 'crew_rate_required',
      blockedLines: [
        { serviceId: 'svc-mow', sectionId: 'sec-1' },
        { serviceId: 'svc-trim' },
      ],
    })
    expect(parseCrewRateRequiredError(err)).toEqual({
      code: 'crew_rate_required',
      blockedLines: [
        { serviceId: 'svc-mow', sectionId: 'sec-1' },
        { serviceId: 'svc-trim' },
      ],
    })
  })

  it('ignores the old plain-text detail', () => {
    const err = new ApiError(422, PYTHON_SENTENCE, [], PYTHON_SENTENCE)
    expect(parseCrewRateRequiredError(err)).toBeNull()
  })

  it('ignores a different error code', () => {
    const err = new ApiError(422, 'Unprocessable Entity', [], {
      code: 'production_rate_required',
      blockedLines: [{ serviceId: 'svc-1' }],
    })
    expect(parseCrewRateRequiredError(err)).toBeNull()
  })

  it('accepts an empty blockedLines list from a create', () => {
    const err = new ApiError(422, 'Unprocessable Entity', [], {
      code: 'crew_rate_required',
      blockedLines: [],
    })
    expect(parseCrewRateRequiredError(err)?.blockedLines).toEqual([])
  })

  it('matches only the listed line, and only in the named section', () => {
    const lines = [{ serviceId: 'svc-mow', sectionId: 'sec-1' }]
    expect(isCrewRateBlockedLine('sec-1', 'svc-mow', lines)).toBe(true)
    expect(isCrewRateBlockedLine('sec-2', 'svc-mow', lines)).toBe(false)
    expect(isCrewRateBlockedLine('sec-1', 'svc-hand', lines)).toBe(false)
  })
})

const derivedKit: CrewRateKitPrice = {
  productionRate: 60_000,
  unitSellCents: 0,
  targetGm: 0.22,
}
const LIVE = 18_000
const formula = sellRateCentsPer1000Sf(60_000, 0.22, LIVE)

describe('isCrewRateDerivedLine', () => {
  it('treats a null or zero sell on a deriving kit as derived, with or without a live rate', () => {
    expect(isCrewRateDerivedLine({ unitSellCents: null, serviceKitId: 'k' }, derivedKit, null)).toBe(true)
    expect(isCrewRateDerivedLine({ unitSellCents: 0, serviceKitId: 'k' }, derivedKit, LIVE)).toBe(true)
  })

  it('treats a sell equal to the live-rate formula as derived', () => {
    expect(
      isCrewRateDerivedLine({ unitSellCents: formula, serviceKitId: 'k' }, derivedKit, LIVE),
    ).toBe(true)
  })

  it('does not treat a positive non-formula sell as derived', () => {
    expect(isCrewRateDerivedLine({ unitSellCents: 999, serviceKitId: 'k' }, derivedKit, LIVE)).toBe(false)
    expect(isCrewRateDerivedLine({ unitSellCents: formula, serviceKitId: 'k' }, derivedKit, null)).toBe(false)
  })

  it('never treats a catalog-priced kit as derived', () => {
    const catalog = { ...derivedKit, unitSellCents: 450 }
    expect(isCrewRateDerivedLine({ unitSellCents: 0, serviceKitId: 'k' }, catalog, null)).toBe(false)
    expect(isCrewRateDerivedLine({ unitSellCents: formula, serviceKitId: 'k' }, catalog, LIVE)).toBe(false)
  })

  it('ignores a kit with no production rate', () => {
    expect(
      isCrewRateDerivedLine(
        { unitSellCents: 0, serviceKitId: 'k' },
        { ...derivedKit, productionRate: null },
        null,
      ),
    ).toBe(false)
    expect(isCrewRateDerivedLine({ unitSellCents: 0, serviceKitId: null }, null, null)).toBe(false)
  })
})

describe('unsavedCrewRateDerivedLines', () => {
  const kits = [{ id: 'kit-derived', ...derivedKit }, { id: 'kit-catalog', ...derivedKit, unitSellCents: 450 }]

  it('marks only unsaved derived lines when the server list is empty', () => {
    const saved = [{ services: [{ id: 'svc-saved' }] }]
    const draft = [
      {
        id: 'sec-1',
        services: [
          { id: 'svc-saved', serviceKitId: 'kit-derived', unitSellCents: 0 },
          { id: 'svc-new-derived', serviceKitId: 'kit-derived', unitSellCents: formula },
          { id: 'svc-new-hand', serviceKitId: 'kit-derived', unitSellCents: 999 },
          { id: 'svc-new-catalog', serviceKitId: 'kit-catalog', unitSellCents: 0 },
        ],
      },
    ]
    expect(unsavedCrewRateDerivedLines(saved, draft, kits, LIVE)).toEqual([
      { serviceId: 'svc-new-derived', sectionId: 'sec-1' },
    ])
  })
})
