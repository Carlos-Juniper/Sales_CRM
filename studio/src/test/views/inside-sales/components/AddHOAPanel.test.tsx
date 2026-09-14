import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { AddHOAPanel } from '@/views/inside-sales/components/accounts/AddHOAPanel'
import type { HOAProperty } from '@/types/accounts'

// ManagementCompanySearch uses useManagementCompanySearch — stub it out so
// AddHOAPanel tests don't need to mock the network layer
vi.mock('@/hooks/useManagementCompanies', () => ({
  useManagementCompanySearch: () => ({ data: [], isLoading: false, isError: false }),
}))

function renderPanel(
  onSave = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
) {
  render(
    <AddHOAPanel
      isOpen={true}
      onClose={onClose}
      onSave={onSave}
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

describe('AddHOAPanel — management company search field', () => {
  it('renders the Management Company search input', () => {
    renderPanel()
    expect(screen.getByPlaceholderText(/search by company name/i)).toBeInTheDocument()
  })

  it('onSave payload has management_company_id=null when no company is selected', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    const nameInput = screen.getByTestId('property-name-input')
    await user.type(nameInput, 'Shadow Wood')

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

// ── Edit mode fixtures ────────────────────────────────────────────

const sampleHOAProperty: HOAProperty = {
  id: 'h1',
  property_name: 'Pelican Bay',
  association_name: 'Pelican Bay Foundation, Inc.',
  address: '6620 Pelican Bay Blvd',
  city: 'Naples',
  state: 'FL',
  zip: '34108',
  county: 'Collier',
  acreage: 570,
  units: 6800,
  status: 'Active',
  contact_status: 'contacted',
  branch: 'Naples',
  assigned_to: 'Marisol Vega',
  last_contacted: '2026-05-20',
  management_company_id: 'pm1',
}

function renderEditPanel(
  onUpdate = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
  initialValues = sampleHOAProperty,
) {
  render(
    <AddHOAPanel
      isOpen={true}
      onClose={onClose}
      onSave={vi.fn()}
      initialValues={initialValues}
      onUpdate={onUpdate}
    />,
  )
  return { onUpdate, onClose }
}

describe('AddHOAPanel — edit mode', () => {
  it('shows "Edit HOA property" as the panel title instead of "Add HOA property"', () => {
    renderEditPanel()
    expect(screen.getByText(/edit hoa property/i)).toBeInTheDocument()
    expect(screen.queryByText(/add hoa property/i)).not.toBeInTheDocument()
  })

  it('shows "Save changes" as the submit button label instead of "Create property"', () => {
    renderEditPanel()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create property/i })).not.toBeInTheDocument()
  })

  it('pre-fills property_name input with the value from initialValues', () => {
    renderEditPanel()
    const nameInput = screen.getByTestId('property-name-input') as HTMLInputElement
    expect(nameInput.value).toBe('Pelican Bay')
  })

  it('pre-fills association_name input with the value from initialValues', () => {
    renderEditPanel()
    const assocInput = screen.getByPlaceholderText(/pelican bay foundation/i) as HTMLInputElement
    expect(assocInput.value).toBe('Pelican Bay Foundation, Inc.')
  })

  it('pre-fills address fields (city, state, zip) with values from initialValues', () => {
    renderEditPanel()
    const cityInput = screen.getByPlaceholderText(/^naples$/i) as HTMLInputElement
    const stateInput = screen.getByPlaceholderText(/^fl$/i) as HTMLInputElement
    const zipInput = screen.getByPlaceholderText(/^34108$/i) as HTMLInputElement
    expect(cityInput.value).toBe('Naples')
    expect(stateInput.value).toBe('FL')
    expect(zipInput.value).toBe('34108')
  })

  it('"Save changes" button is enabled immediately because property_name is pre-filled', () => {
    renderEditPanel()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })

  it('submitting calls onUpdate with a correctly shaped payload', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderEditPanel(onUpdate)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    const payload = onUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(payload.property_name).toBe('Pelican Bay')
    expect(payload.city).toBe('Naples')
    expect(payload.state).toBe('FL')
  })

  it('submitting in edit mode never calls onSave', async () => {
    const onSave = vi.fn()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(
      <AddHOAPanel
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        initialValues={sampleHOAProperty}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('closing the panel and reopening resets fields back to initialValues, not empty', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderEditPanel(vi.fn().mockResolvedValue(undefined), onClose)

    // Edit the property name
    const nameInput = screen.getByTestId('property-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'Temporary Edit')
    expect((nameInput as HTMLInputElement).value).toBe('Temporary Edit')

    // Cancel — this calls handleClose which resets to initialValues
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)

    // The input should have been reset to the original value during handleClose
    // (onClose is called after the internal reset, so the value is restored)
    expect((nameInput as HTMLInputElement).value).toBe('Pelican Bay')
  })

  it('create mode (no initialValues) still shows "Add HOA property" title and calls onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    // Use the standard create-mode renderPanel
    renderPanel(onSave)

    expect(screen.getByText(/add hoa property/i)).toBeInTheDocument()

    await user.type(screen.getByTestId('property-name-input'), 'New Property')
    await user.click(screen.getByRole('button', { name: /create property/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  })
})
