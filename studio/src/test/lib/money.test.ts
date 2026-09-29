import { describe, expect, it } from 'vitest'
import { formatCents } from '@/lib/money'

describe('formatCents', () => {
  it('renders exact dollars from integer cents', () => {
    expect(formatCents(2_494_800)).toBe('$24,948.00')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(50)).toBe('$0.50')
  })
})
