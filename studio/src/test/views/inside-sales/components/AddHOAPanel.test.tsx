import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { AddHOAPanel } from '@/views/inside-sales/components/accounts/AddHOAPanel'
import type { ManagementCompany } from '@/types/accounts'

// ── Fixtures ──────────────────────────────────────────────────────

const sampleCompanies: ManagementCompany[] = [
  {
    id: 'pm1',
    company_name: 'Alliant Property Management',
    website: 'www.alliantproperty.com',
    phone: '(239) 454-1101',
    street: '13831 Vector Ave',
    city: 'Fort Myers',
    state: 'FL',
    zip: '33907',
    primary_email: 'service@alliantproperty.com',
    branch_id: 'b1',
    assigned_to: 'Trent Boyd',
    status: 'Partner',
    contact_status: 'contacted',
    last_contacted: '2026-05-30',
    contacts: [],
  },
  {
    id: 'pm2',
    company_name: 'Resort Management',
    website: 'www.resortgroupinc.com',
    phone: '(239) 649-5526',
    street: '2685 Horseshoe Dr S',
    city: 'Naples',
    state: 'FL',
    zip: '34104',
    primary_email: 'info@resortgroupinc.com',
    branch_id: 'b2',
    assigned_to: 'Marisol Vega',
    status: 'Partner',
    contact_status: 'contacted',
    last_contacted: '2026-05-12',
    contacts: [],
  },
]

function renderPanel(
  onSave = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
) {
  render(
    <AddHOAPanel
      isOpen={true}
      onClose={onClose}
      onSave={onSave}
      managementCompanies={sampleCompanies}
    />,
  )
  return { onSave, onClose }
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AddHOAPanel — create button state', () => {
  it('"Create property" button is disabled when property_name is empty', () => {
    renderPanel()
    const createBtn = screen.getByRole('button', { name: /create property/i })
    expect(createBtn).toBeDisabled()
  })

  it('"Create property" button is enabled once property_name has a value', async () => {
    const user = userEvent.setup()
    renderPanel()

    const nameInput = screen.getByTestId('property-name-input')
    await user.type(nameInput, 'Shadow Wood')

    const createBtn = screen.getByRole('button', { name: /create property/i })
    expect(createBtn).toBeEnabled()
  })

  it('"Create property" button is disabled again if property_name is cleared', async () => {
    const user = userEvent.setup()
    renderPanel()

    const nameInput = screen.getByTestId('property-name-input')
    await user.type(nameInput, 'Shadow Wood')
    await user.clear(nameInput)

    const createBtn = screen.getByRole('button', { name: /create property/i })
    expect(createBtn).toBeDisabled()
  })
})

describe('AddHOAPanel — management company dropdown', () => {
  it('renders all management company options in the dropdown', async () => {
    renderPanel()

    const select = screen.getByRole('combobox', { name: /management company/i })
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Alliant Property Management' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Resort Management' })).toBeInTheDocument()
  })

  it('renders a "Self-managed / none" option in the dropdown', () => {
    renderPanel()
    expect(screen.getByRole('option', { name: /self-managed/i })).toBeInTheDocument()
  })

  it('selecting a management company includes its id in onSave payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    const nameInput = screen.getByTestId('property-name-input')
    await user.type(nameInput, 'Shadow Wood')

    const select = screen.getByRole('combobox', { name: /management company/i })
    await user.selectOptions(select, 'pm1')

    const createBtn = screen.getByRole('button', { name: /create property/i })
    await user.click(createBtn)

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0] as Record<string, unknown>
    expect(payload.management_company_id).toBe('pm1')
  })

  it('onSave payload has management_company_id=null when self-managed is selected', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    const nameInput = screen.getByTestId('property-name-input')
    await user.type(nameInput, 'Shadow Wood')

    const select = screen.getByRole('combobox', { name: /management company/i })
    await user.selectOptions(select, '')

    const createBtn = screen.getByRole('button', { name: /create property/i })
    await user.click(createBtn)

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0] as Record<string, unknown>
    expect(payload.management_company_id).toBeNull()
  })
})

describe('AddHOAPanel — form submission', () => {
  it('submitting calls onSave with a correctly shaped object including property_name', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    await user.type(screen.getByTestId('property-name-input'), 'Shadow Wood')
    await user.type(screen.getByPlaceholderText(/pelican bay foundation/i), 'Shadow Wood at The Brooks')
    await user.type(screen.getByPlaceholderText(/6620 pelican bay blvd/i), '9740 Commerce Center Ct')
    await user.type(screen.getByPlaceholderText(/naples/i), 'Estero')

    await user.click(screen.getByRole('button', { name: /create property/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0] as Record<string, unknown>
    expect(payload.property_name).toBe('Shadow Wood')
    expect(payload.association_name).toBe('Shadow Wood at The Brooks')
    expect(payload.city).toBe('Estero')
  })

  it('does not call onSave when property_name is blank and button is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    const createBtn = screen.getByRole('button', { name: /create property/i })
    // Button should be disabled — click should not invoke onSave
    await user.click(createBtn)

    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('AddHOAPanel — cancel', () => {
  it('"Cancel" button calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderPanel(vi.fn().mockResolvedValue(undefined), onClose)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
