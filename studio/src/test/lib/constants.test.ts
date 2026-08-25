import { describe, it, expect } from 'vitest'
import {
  BID_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  KANBAN_COLUMNS,
  DISQUALIFY_REASONS,
  PAGE_SIZE,
  LEAD_TYPE_COLORS,
  STATUS_COLORS,
} from '@/lib/constants'
import type { BidStatus } from '@/types'

describe('BID_STATUS_LABELS', () => {
  const allBidStatuses: BidStatus[] = ['pending', 'pursuing', 'submitted', 'no_bid', 'won', 'lost']

  it('has an entry for every BidStatus', () => {
    for (const status of allBidStatuses) {
      expect(BID_STATUS_LABELS).toHaveProperty(status)
    }
  })

  it('every label is a non-empty string', () => {
    for (const [, label] of Object.entries(BID_STATUS_LABELS)) {
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('has exactly 6 entries (one per BidStatus)', () => {
    expect(Object.keys(BID_STATUS_LABELS)).toHaveLength(6)
  })

  it('no duplicate labels', () => {
    const labels = Object.values(BID_STATUS_LABELS)
    const unique = new Set(labels)
    expect(unique.size).toBe(labels.length)
  })

  it('known label values are correct', () => {
    expect(BID_STATUS_LABELS.pending).toBe('Pending')
    expect(BID_STATUS_LABELS.pursuing).toBe('Pursuing')
    expect(BID_STATUS_LABELS.submitted).toBe('Submitted')
    expect(BID_STATUS_LABELS.no_bid).toBe('No Bid')
    expect(BID_STATUS_LABELS.won).toBe('Won')
    expect(BID_STATUS_LABELS.lost).toBe('Lost')
  })
})

describe('LEAD_STATUS_LABELS', () => {
  it('covers core statuses', () => {
    const expected = ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost', 'estimating', 'op_review', 'approved', 'disqualified']
    for (const s of expected) {
      expect(LEAD_STATUS_LABELS).toHaveProperty(s)
    }
  })

  it('every value is a non-empty string', () => {
    for (const [, label] of Object.entries(LEAD_STATUS_LABELS)) {
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('proposal_sent label includes a space', () => {
    expect(LEAD_STATUS_LABELS.proposal_sent).toBe('Proposal Sent')
  })

  it('estimate write-back statuses label correctly', () => {
    expect(LEAD_STATUS_LABELS.estimating).toBe('Estimating')
    expect(LEAD_STATUS_LABELS.op_review).toBe('OP Review')
    expect(LEAD_STATUS_LABELS.approved).toBe('Approved')
  })
})

describe('LEAD_TYPE_COLORS', () => {
  it('has entries for HOA, commercial, deathcare, and resort', () => {
    expect(LEAD_TYPE_COLORS).toHaveProperty('HOA')
    expect(LEAD_TYPE_COLORS).toHaveProperty('commercial')
    expect(LEAD_TYPE_COLORS).toHaveProperty('deathcare')
    expect(LEAD_TYPE_COLORS).toHaveProperty('resort')
  })

  it('each entry has bg, text, and border class strings', () => {
    for (const [, colors] of Object.entries(LEAD_TYPE_COLORS)) {
      expect(typeof colors.bg).toBe('string')
      expect(typeof colors.text).toBe('string')
      expect(typeof colors.border).toBe('string')
    }
  })
})

describe('STATUS_COLORS', () => {
  it('has entries for all pipeline statuses', () => {
    const statuses = ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost', 'estimating', 'op_review', 'approved', 'disqualified']
    for (const s of statuses) {
      expect(STATUS_COLORS).toHaveProperty(s)
    }
  })

  it('each entry has bg and text class strings', () => {
    for (const [, colors] of Object.entries(STATUS_COLORS)) {
      expect(typeof colors.bg).toBe('string')
      expect(typeof colors.text).toBe('string')
    }
  })
})

describe('KANBAN_COLUMNS', () => {
  it('has 4 columns', () => {
    expect(KANBAN_COLUMNS).toHaveLength(4)
  })

  it('columns are the four pipeline stages (estimate write-back model)', () => {
    const ids = KANBAN_COLUMNS.map(c => c.id)
    expect(ids).toContain('qualifying')
    expect(ids).toContain('estimating')
    expect(ids).toContain('op_review')
    expect(ids).toContain('approved')
  })

  it('each column has a non-empty title and color', () => {
    for (const col of KANBAN_COLUMNS) {
      expect(col.title.length).toBeGreaterThan(0)
      expect(col.color.length).toBeGreaterThan(0)
    }
  })
})

describe('DISQUALIFY_REASONS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(DISQUALIFY_REASONS)).toBe(true)
    expect(DISQUALIFY_REASONS.length).toBeGreaterThan(0)
  })

  it('every item is a non-empty string', () => {
    for (const reason of DISQUALIFY_REASONS) {
      expect(typeof reason).toBe('string')
      expect(reason.length).toBeGreaterThan(0)
    }
  })

  it('includes "Other" as a catch-all', () => {
    expect(DISQUALIFY_REASONS).toContain('Other')
  })
})

describe('PAGE_SIZE', () => {
  it('is 25', () => {
    expect(PAGE_SIZE).toBe(25)
  })
})
