import { describe, it, expect } from 'vitest'
import { displayRef, matchesRef } from '@/lib/estimating/displayRef'

// Minimal shape displayRef reads — a partial estimate.
function est(over: Partial<Parameters<typeof displayRef>[0]> = {}) {
  return {
    id: 'est-abc123',
    aspireNumber: null,
    aspireSyncStatus: 'pending' as const,
    ...over,
  }
}

describe('displayRef', () => {
  it('shows the Aspire number when synced', () => {
    const ref = displayRef(est({ aspireNumber: '408123', aspireSyncStatus: 'synced' }))
    expect(ref).toEqual({ text: '408123', state: 'synced' })
  })

  it('shows a pending chip when the push has not landed yet', () => {
    const ref = displayRef(est({ aspireNumber: null, aspireSyncStatus: 'pending' }))
    expect(ref.state).toBe('pending')
    expect(ref.text).toMatch(/pending/i)
  })

  it('shows a failed chip when the push failed', () => {
    const ref = displayRef(est({ aspireNumber: null, aspireSyncStatus: 'failed' }))
    expect(ref.state).toBe('failed')
    expect(ref.text).toMatch(/fail/i)
  })

  it('still shows the number during coexistence even if status lags', () => {
    // Number already assigned but a later re-sync is pending — show the number,
    // flag the state so the UI can indicate it is still settling.
    const ref = displayRef(est({ aspireNumber: '408123', aspireSyncStatus: 'pending' }))
    expect(ref.text).toBe('408123')
    expect(ref.state).toBe('pending')
  })

  it('defaults missing sync status to synced when a number is present', () => {
    const ref = displayRef({ id: 'est-1', aspireNumber: 'ASP-9', aspireSyncStatus: undefined })
    expect(ref).toEqual({ text: 'ASP-9', state: 'synced' })
  })
})

describe('matchesRef', () => {
  const e = est({ id: 'est-abc123', aspireNumber: '408123', aspireSyncStatus: 'synced' })

  it('matches on the Aspire number', () => {
    expect(matchesRef(e, '4081')).toBe(true)
  })

  it('matches on the internal id', () => {
    expect(matchesRef(e, 'abc123')).toBe(true)
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchesRef(est({ aspireNumber: 'ASP-9' }), '  asp-9 ')).toBe(true)
  })

  it('returns true for an empty query (no filter)', () => {
    expect(matchesRef(e, '')).toBe(true)
  })

  it('does not match an unrelated term', () => {
    expect(matchesRef(e, 'zzz')).toBe(false)
  })
})
