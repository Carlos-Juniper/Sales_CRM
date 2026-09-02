// ---------------------------------------------------------------------------
// Slice 10a (part 2) — Company read-only sections.
//
// Regions has no backing table yet (deferred to Handoff 40) and static content
// is code-managed (lib/proposal/staticContent.ts). Neither has a write endpoint,
// so both render read-only with a clear note rather than a fabricated form.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { CompanySection } from '@/views/settings/company/CompanySection'
import { RegionsSection } from '@/views/settings/company/RegionsSection'
import { StaticContentSection } from '@/views/settings/company/StaticContentSection'

function renderComp(ui: React.ReactElement, role = 'admin') {
  useAuthStore.setState({ user: makeUser({ role: role as never }) })
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return rtlRender(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ role: 'admin' }) })
})

describe('RegionsSection', () => {
  it('renders read-only with a "not yet configurable" note (no form controls)', () => {
    renderComp(<RegionsSection />)
    expect(screen.getByTestId('settings-section-regions')).toBeInTheDocument()
    expect(screen.getByText(/not yet a configurable surface/i)).toBeInTheDocument()
    // No save button — there is no backing write endpoint.
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
  })
})

describe('StaticContentSection', () => {
  it('renders read-only, states it is code-managed, and lists content blocks', () => {
    renderComp(<StaticContentSection />)
    expect(
      screen.getByTestId('settings-section-static-content'),
    ).toBeInTheDocument()
    expect(screen.getByText(/code-managed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
  })
})

describe('CompanySection routes read-only slugs', () => {
  it('routes the regions slug to the read-only section', () => {
    renderComp(<CompanySection slug="regions" label="Regions" />)
    expect(screen.getByTestId('settings-section-regions')).toBeInTheDocument()
  })

  it('routes the static-content slug to the read-only section', () => {
    renderComp(<CompanySection slug="static-content" label="Static content" />)
    expect(
      screen.getByTestId('settings-section-static-content'),
    ).toBeInTheDocument()
  })
})
