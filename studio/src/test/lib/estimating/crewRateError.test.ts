import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/client'
import {
  CREW_RATE_ERROR_MESSAGES,
  CREW_RATE_REQUIRED_CODE,
  isCrewRateBlockedLine,
  messageForErrorCode,
  parseCrewRateRequiredError,
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

  it('matches only the listed line, and only in the named section', () => {
    const lines = [{ serviceId: 'svc-mow', sectionId: 'sec-1' }]
    expect(isCrewRateBlockedLine('sec-1', 'svc-mow', lines)).toBe(true)
    expect(isCrewRateBlockedLine('sec-2', 'svc-mow', lines)).toBe(false)
    expect(isCrewRateBlockedLine('sec-1', 'svc-hand', lines)).toBe(false)
  })
})
