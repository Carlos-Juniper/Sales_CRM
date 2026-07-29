// ---------------------------------------------------------------------------
// Handoffs 03/04 — engine selection. The Line-Item Editor is keyed
// AUTOMATICALLY off `estimate.estimateType`; there is NO mode toggle anywhere
// (hard product requirement).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import type { Estimate } from '@/types/estimating'
import { buildMaintenanceEstimate, buildInstallEstimate } from '@/mocks/estimatingData'
import { LineItemEditor } from '@/views/inside-sales/components/estimating/LineItemEditor'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { EstimatingShellContext } from '@/views/inside-sales/components/estimating/useEstimatingShell'

export function renderEditor(openEstimate: Estimate | null) {
  const setOpenEstimate = vi.fn()
  const utils = render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider
        value={{ activeTab: 'editor', setActiveTab: vi.fn(), openEstimate, setOpenEstimate }}
      >
        <LineItemEditor />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>,
  )
  return { ...utils, setOpenEstimate }
}

describe('LineItemEditor engine selection (no mode toggle, ever)', () => {
  it('renders the maintenance engine for a maintenance estimate', () => {
    renderEditor(buildMaintenanceEstimate())
    expect(screen.getByTestId('maintenance-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('install-editor')).not.toBeInTheDocument()
  })

  it('NEVER renders the maintenance engine for an install estimate', () => {
    renderEditor(buildInstallEstimate())
    expect(screen.queryByTestId('maintenance-editor')).not.toBeInTheDocument()
    expect(screen.getByTestId('install-editor')).toBeInTheDocument()
  })

  it('exposes no Maintenance/Install mode switch UI', () => {
    renderEditor(buildMaintenanceEstimate())
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^maintenance$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /maintain/i })).not.toBeInTheDocument()
  })

  it('renders an empty state when no estimate is open', () => {
    renderEditor(null)
    expect(screen.getByTestId('editor-empty')).toBeInTheDocument()
    expect(screen.getByText(/no estimate open/i)).toBeInTheDocument()
  })
})
