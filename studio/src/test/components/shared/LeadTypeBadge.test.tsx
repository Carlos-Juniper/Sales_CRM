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

  it('renders Commercial badge with title-case label', () => {
    render(<LeadTypeBadge type="commercial" />)
    expect(screen.getByText('Commercial')).toBeInTheDocument()
  })

  it('commercial badge has amber styling', () => {
    const { container } = render(<LeadTypeBadge type="commercial" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-amber-100')
  })

  it('renders Deathcare badge with slate styling', () => {
    const { container } = render(<LeadTypeBadge type="deathcare" />)
    expect(screen.getByText('Deathcare')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-slate-100')
    expect(badge.className).not.toContain('bg-purple')
  })

  it('renders resort badge as "Resort"', () => {
    render(<LeadTypeBadge type="resort" />)
    expect(screen.getByText('Resort')).toBeInTheDocument()
  })

  it('renders Healthcare badge with rose styling', () => {
    const { container } = render(<LeadTypeBadge type="healthcare" />)
    expect(screen.getByText('Healthcare')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-rose-100')
  })

  it('unknown type falls back to zinc styling and renders the raw value', () => {
    const { container } = render(<LeadTypeBadge type={'unknown' as LeadType} />)
    expect(screen.getByText('unknown')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('bg-zinc-100')
  })
})
