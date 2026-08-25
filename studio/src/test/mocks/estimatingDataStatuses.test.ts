// The mock fixture must carry only canonical EstimateStatus
// values. The legacy status types ('draft'/'sent' stragglers) are deleted;
// this pins the fixture so stale values cannot creep back in.
import { describe, expect, it } from 'vitest'
import type { EstimateStatus } from '@/types/estimating'
import { mockEstimateQueue, mockEstimates } from '@/mocks/estimatingData'

const CANONICAL: EstimateStatus[] = [
  'new_from_sales',
  'queued',
  'in_progress',
  'review',
  'pending_approval',
  'approved',
  'handed_back',
  'won',
  'lost',
]

describe('estimatingData fixture statuses', () => {
  it('every queue item status is a canonical EstimateStatus', () => {
    for (const item of mockEstimateQueue) {
      expect(CANONICAL).toContain(item.status)
    }
  })

  it('every legacy estimate status is a canonical EstimateStatus (no draft/sent)', () => {
    for (const est of mockEstimates) {
      expect(CANONICAL).toContain(est.status)
    }
  })
})
