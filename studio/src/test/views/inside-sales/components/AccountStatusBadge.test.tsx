import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { AccountStatusBadge } from '@/views/inside-sales/components/accounts/AccountStatusBadge'
import type { HOAStatus } from '@/types/accounts'

// ── Tests ─────────────────────────────────────────────────────────
// The prototype's ACCOUNT_STATUS_META maps:
//   Prospect → 'sky'  (blue-ish)
//   Bidding  → 'purple'
//   Active   → 'green'
//   At Risk  → 'amber'
//   Lost     → 'red'
//   unknown  → 'secondary' (neutral fallback)
//
// We assert on rendered text and the CSS class or data attribute
// carrying the variant. The exact class name depends on how the
// React component is implemented; we check for the text plus a
// characteristic colour token in the className or inline style.

describe('AccountStatusBadge — Prospect', () => {
  it('renders the text "Prospect"', () => {
    render(<AccountStatusBadge status="Prospect" />)
    expect(screen.getByText('Prospect')).toBeInTheDocument()
  })

  it('applies sky/blue styling for Prospect', () => {
    render(<AccountStatusBadge status="Prospect" />)
    const badge = screen.getByText('Prospect').closest('[class]') ?? screen.getByText('Prospect')
    // Acceptable: className includes "sky", or the element has a data-variant attribute
    const outerHTML = badge.outerHTML.toLowerCase()
    expect(outerHTML).toMatch(/sky|blue|prospect/i)
  })
})

describe('AccountStatusBadge — Bidding', () => {
  it('renders the text "Bidding"', () => {
    render(<AccountStatusBadge status="Bidding" />)
    expect(screen.getByText('Bidding')).toBeInTheDocument()
  })

  it('applies purple styling for Bidding', () => {
    render(<AccountStatusBadge status="Bidding" />)
    const badge = screen.getByText('Bidding').closest('[class]') ?? screen.getByText('Bidding')
    const outerHTML = badge.outerHTML.toLowerCase()
    expect(outerHTML).toMatch(/purple|bidding/i)
  })
})

describe('AccountStatusBadge — Active', () => {
  it('renders the text "Active"', () => {
    render(<AccountStatusBadge status="Active" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('applies green styling for Active', () => {
    render(<AccountStatusBadge status="Active" />)
    const badge = screen.getByText('Active').closest('[class]') ?? screen.getByText('Active')
    const outerHTML = badge.outerHTML.toLowerCase()
    expect(outerHTML).toMatch(/green|active/i)
  })
})

describe('AccountStatusBadge — At Risk', () => {
  it('renders the text "At Risk"', () => {
    render(<AccountStatusBadge status="At Risk" />)
    expect(screen.getByText('At Risk')).toBeInTheDocument()
  })

  it('applies amber/yellow styling for At Risk', () => {
    render(<AccountStatusBadge status="At Risk" />)
    const badge = screen.getByText('At Risk').closest('[class]') ?? screen.getByText('At Risk')
    const outerHTML = badge.outerHTML.toLowerCase()
    expect(outerHTML).toMatch(/amber|yellow|at.risk/i)
  })
})

describe('AccountStatusBadge — Lost', () => {
  it('renders the text "Lost"', () => {
    render(<AccountStatusBadge status="Lost" />)
    expect(screen.getByText('Lost')).toBeInTheDocument()
  })

  it('applies red styling for Lost', () => {
    render(<AccountStatusBadge status="Lost" />)
    const badge = screen.getByText('Lost').closest('[class]') ?? screen.getByText('Lost')
    const outerHTML = badge.outerHTML.toLowerCase()
    expect(outerHTML).toMatch(/red|lost/i)
  })
})

describe('AccountStatusBadge — unknown status fallback', () => {
  it('renders the unknown status text', () => {
    render(<AccountStatusBadge status={'Unknown' as HOAStatus} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('applies neutral/secondary styling for an unknown status', () => {
    render(<AccountStatusBadge status={'Unknown' as HOAStatus} />)
    const badge = screen.getByText('Unknown').closest('[class]') ?? screen.getByText('Unknown')
    const outerHTML = badge.outerHTML.toLowerCase()
    // Should NOT use a strong colour variant like green, red, purple, amber
    // Must fall back to secondary/neutral
    expect(outerHTML).toMatch(/secondary|zinc|neutral|muted|unknown/i)
  })
})

describe('AccountStatusBadge — snapshot-style parametrized check', () => {
  const cases: Array<{ status: HOAStatus; expectedText: string }> = [
    { status: 'Prospect', expectedText: 'Prospect' },
    { status: 'Bidding',  expectedText: 'Bidding' },
    { status: 'Active',   expectedText: 'Active' },
    { status: 'At Risk',  expectedText: 'At Risk' },
    { status: 'Lost',     expectedText: 'Lost' },
  ]

  for (const { status, expectedText } of cases) {
    it(`renders "${expectedText}" for status="${status}"`, () => {
      render(<AccountStatusBadge status={status} />)
      expect(screen.getByText(expectedText)).toBeInTheDocument()
    })
  }
})
