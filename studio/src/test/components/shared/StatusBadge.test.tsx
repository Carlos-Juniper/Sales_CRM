import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { LeadStatus } from '@/types'

describe('StatusBadge', () => {
  const cases: [LeadStatus, string][] = [
    ['new', 'New'],
    ['contacted', 'Contacted'],
    ['qualified', 'Qualified'],
    ['proposal_sent', 'Proposal Sent'],
    ['won', 'Won'],
    ['lost', 'Lost'],
    ['handed_off', 'Handed Off'],
  ]

  it.each(cases)('status "%s" renders label "%s"', (status, label) => {
    render(<StatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('renders without crash for unknown/undefined status', () => {
    expect(() =>
      render(<StatusBadge status={'unknown_status' as LeadStatus} />),
    ).not.toThrow()
  })

  it('renders with correct sky color for "new"', () => {
    const { container } = render(<StatusBadge status="new" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-sky-100')
  })

  it('renders with correct green color for "qualified"', () => {
    const { container } = render(<StatusBadge status="qualified" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-green-100')
  })
})
