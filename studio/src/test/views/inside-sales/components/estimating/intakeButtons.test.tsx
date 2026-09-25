import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, makeUser } from '@/test/utils'
import { server } from '@/mocks/server'
import { useAuthStore } from '@/store/authStore'
import { EstimateQueue } from '@/views/inside-sales/components/estimating/EstimateQueue'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import {
  EstimatingShellContext,
  type EstimatingShellApi,
} from '@/views/inside-sales/components/estimating/useEstimatingShell'
import { InstallIntakeModal } from '@/views/inside-sales/components/estimating/InstallIntakeModal'
import { MaintenanceIntakeModal } from '@/views/inside-sales/components/estimating/MaintenanceIntakeModal'
import { allowedIntakeTypes } from '@/lib/intakeAccess'
import type { IntakeType } from '@/types'

window.HTMLElement.prototype.hasPointerCapture = vi.fn()
window.HTMLElement.prototype.releasePointerCapture = vi.fn()
window.HTMLElement.prototype.scrollIntoView = vi.fn()

function shell(): EstimatingShellApi {
  return {
    activeTab: 'queue',
    setActiveTab: vi.fn(),
    openEstimate: null,
    setOpenEstimate: vi.fn(),
    openEstimateAt: vi.fn(),
  }
}

function renderQueue(allowed?: IntakeType[]) {
  useAuthStore.setState({
    user: makeUser({
      allowed_intake_types: allowed,
    }),
  })
  server.use(http.get('/api/estimating/estimates', () => HttpResponse.json([])))
  render(
    <EstimatingToastProvider>
      <EstimatingShellContext.Provider value={shell()}>
        <EstimateQueue onMaintenanceIntake={vi.fn()} onInstallIntake={vi.fn()} />
      </EstimatingShellContext.Provider>
    </EstimatingToastProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser() })
})

describe('intake buttons follow allowed_intake_types', () => {
  it('shows only Maintenance when the server allows maintenance', async () => {
    renderQueue(['maintenance'])
    expect(await screen.findByRole('button', { name: /maintenance intake/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /install intake/i })).not.toBeInTheDocument()
  })

  it('shows only Install when the server allows install', async () => {
    renderQueue(['install'])
    expect(await screen.findByRole('button', { name: /install intake/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /maintenance intake/i })).not.toBeInTheDocument()
  })

  it('shows both when the server allows both', async () => {
    renderQueue(['maintenance', 'install'])
    expect(await screen.findByRole('button', { name: /maintenance intake/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /install intake/i })).toBeInTheDocument()
  })

  it('shows both when an older session omits the field', () => {
    expect(allowedIntakeTypes(makeUser())).toEqual(['maintenance', 'install'])
    expect(allowedIntakeTypes({ allowed_intake_types: undefined })).toEqual(['maintenance', 'install'])
    renderQueue(undefined)
    expect(screen.getByRole('button', { name: /maintenance intake/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /install intake/i })).toBeInTheDocument()
  })
})

describe('disallowed intake 403', () => {
  it('shows the server message when saving an install draft is refused', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/estimating/intake/drafts', () => HttpResponse.json([])),
      http.post('/api/estimating/intake/drafts', () =>
        HttpResponse.json(
          { detail: 'Role may only submit maintenance intakes.' },
          { status: 403 },
        ),
      ),
    )
    render(
      <EstimatingToastProvider>
        <EstimatingShellContext.Provider value={shell()}>
          <InstallIntakeModal open onClose={vi.fn()} onCreated={vi.fn()} />
        </EstimatingShellContext.Provider>
      </EstimatingToastProvider>,
    )
    await user.click(await screen.findByRole('button', { name: /save draft/i }))
    expect(await screen.findByText('Role may only submit maintenance intakes.')).toBeInTheDocument()
  })

  it('shows the server message when creating a maintenance estimate is refused', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/estimating/estimates', () =>
        HttpResponse.json(
          { detail: 'Role may only submit install intakes.' },
          { status: 403 },
        ),
      ),
    )
    render(
      <EstimatingToastProvider>
        <EstimatingShellContext.Provider value={shell()}>
          <MaintenanceIntakeModal
            open
            onClose={vi.fn()}
            onCreated={vi.fn()}
            crmLead={{ leadNumber: 'L-1', rep: 'Ada', winProbability: 0.5 }}
            initialProperty={{
              id: 'prop-1',
              name: 'Oak Court',
              address1: '1 Oak',
              address2: null,
              city: 'Naples',
              state: 'FL',
              zip: '34102',
              branchCity: 'Naples, FL',
              customerType: 'hoa',
              managementCompanyId: null,
              acreage: null,
              units: null,
              aspirePropertyId: null,
              aspireSyncStatus: 'unsynced',
              propertyType: 'hoa',
              sourceType: 'hoa',
              sourceId: 'hoa-1',
              createdAt: null,
              updatedAt: null,
            }}
          />
        </EstimatingShellContext.Provider>
      </EstimatingToastProvider>,
    )
    const dialog = await screen.findByRole('dialog')
    const scope = within(dialog)
    await user.type(scope.getByLabelText(/contact name/i), 'Jane Smith')
    await user.type(scope.getByLabelText(/company/i), 'Oak Court HOA')
    await user.type(scope.getByLabelText(/phone/i), '602-555-1234')
    await user.type(scope.getByLabelText(/email/i), 'jane@example.com')
    await user.type(scope.getByLabelText(/additional scope notes/i), 'Full grounds maintenance')
    await scope.findByRole('option', { name: 'Bradenton, FL' })
    await user.selectOptions(scope.getByLabelText(/^branch/i) as HTMLSelectElement, 'Bradenton, FL')
    await user.click(scope.getByRole('button', { name: /submit/i }))
    await waitFor(() =>
      expect(document.body).toHaveTextContent('Role may only submit install intakes.'),
    )
  })
})
