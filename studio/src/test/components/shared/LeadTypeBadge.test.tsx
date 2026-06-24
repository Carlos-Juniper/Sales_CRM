import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { LeadTypeBadge } from '@/components/shared/LeadTypeBadge'
import type { LeadType } from '@/types'

describe('LeadTypeBadge', () => {
  it('renders HOA badge', () => {
    render(<LeadTypeBadge type="HOA" />)
    expect(screen.getByText('HOA')).toBeInTheDocument()
  })

  it('HOA badge has green styling', () => {
    const { container } = render(<LeadTypeBadge type="HOA" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-green-100')
  })

  it('renders commercial badge', () => {
    render(<LeadTypeBadge type="commercial" />)
    expect(screen.getByText('Commercial')).toBeInTheDocument()
  })

  it('commercial badge has amber styling', () => {
    const { container } = render(<LeadTypeBadge type="commercial" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-amber-100')
  })

  it('renders Commercial badge', () => {
    render(<LeadTypeBadge type={'commercial' as LeadType} />)
    expect(screen.getByText('Commercial')).toBeInTheDocument()
  })

  it('Commercial badge has amber styling', () => {
    const { container } = render(<LeadTypeBadge type={'commercial' as LeadType} />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-amber-100')
  })

  it('unknown type renders without crash', () => {
    expect(() => render(<LeadTypeBadge type={'unknown' as LeadType} />)).not.toThrow()
  })
})
