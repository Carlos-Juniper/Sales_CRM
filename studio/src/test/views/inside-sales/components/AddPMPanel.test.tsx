import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { AddPMPanel } from '@/views/inside-sales/components/accounts/AddPMPanel'
import type { ManagementCompany } from '@/types/accounts'

// ── Helpers ───────────────────────────────────────────────────────

function renderPanel(
  onSave = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
) {
  render(<AddPMPanel isOpen={true} onClose={onClose} onSave={onSave} />)
  return { onSave, onClose }
}

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AddPMPanel — create button state', () => {
  it('"Create company" button is disabled when company_name is empty', () => {
    renderPanel()
    const createBtn = screen.getByRole('button', { name: /create company/i })
    expect(createBtn).toBeDisabled()
  })

  it('"Create company" button is enabled once company_name has a value', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByPlaceholderText(/alliant property management/i), 'New PM Co')

    const createBtn = screen.getByRole('button', { name: /create company/i })
    expect(createBtn).toBeEnabled()
  })

  it('"Create company" button returns to disabled when company_name is cleared', async () => {
    const user = userEvent.setup()
    renderPanel()

    const input = screen.getByPlaceholderText(/alliant property management/i)
    await user.type(input, 'New PM Co')
    await user.clear(input)

    expect(screen.getByRole('button', { name: /create company/i })).toBeDisabled()
  })
})

describe('AddPMPanel — contact rows', () => {
  it('renders one contact row on initial open', () => {
    renderPanel()
    // The panel starts with one "Contact 1" section
    expect(screen.getByText(/contact 1/i)).toBeInTheDocument()
    expect(screen.queryByText(/contact 2/i)).not.toBeInTheDocument()
  })

  it('"Add contact" button appends a new contact row', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /add contact/i }))

    expect(screen.getByText(/contact 1/i)).toBeInTheDocument()
    expect(screen.getByText(/contact 2/i)).toBeInTheDocument()
  })

  it('"Add contact" button can be clicked multiple times to add more rows', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /add contact/i }))
    await user.click(screen.getByRole('button', { name: /add contact/i }))

    expect(screen.getByText(/contact 3/i)).toBeInTheDocument()
  })

  it('remove button does not appear when only one contact row exists', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: /remove contact/i })).not.toBeInTheDocument()
  })

  it('remove button appears on each row when >1 contacts exist', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /add contact/i }))

    const removeButtons = screen.getAllByRole('button', { name: /remove contact/i })
    expect(removeButtons).toHaveLength(2)
  })

  it('clicking remove on second contact row removes it and leaves first intact', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: /add contact/i }))

    const removeButtons = screen.getAllByRole('button', { name: /remove contact/i })
    await user.click(removeButtons[1])

    expect(screen.getByText(/contact 1/i)).toBeInTheDocument()
    expect(screen.queryByText(/contact 2/i)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /remove contact/i })).toHaveLength(0)
  })
})

describe('AddPMPanel — submission and contact filtering', () => {
  it('submitting calls onSave with correctly shaped object including company_name', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    await user.type(screen.getByPlaceholderText(/alliant property management/i), 'Resort Management')
    await user.type(screen.getByPlaceholderText(/www\.alliantproperty\.com/i), 'www.resortgroupinc.com')
    await user.type(screen.getByPlaceholderText(/fort myers/i), 'Naples')

    await user.click(screen.getByRole('button', { name: /create company/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0] as Record<string, unknown>
    expect(payload.company_name).toBe('Resort Management')
    expect(payload.city).toBe('Naples')
  })

  it('onSave payload includes contacts array', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    await user.type(screen.getByPlaceholderText(/alliant property management/i), 'Resort Management')

    await user.click(screen.getByRole('button', { name: /create company/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0] as Record<string, unknown>
    expect(Array.isArray(payload.contacts)).toBe(true)
  })

  it('filters out contacts with both empty name and email from the onSave payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    await user.type(screen.getByPlaceholderText(/alliant property management/i), 'Resort Management')

    // Add a second contact but leave it blank — it should be filtered out
    await user.click(screen.getByRole('button', { name: /add contact/i }))

    // Fill in only the first contact
    const nameInputs = screen.getAllByPlaceholderText(/dana whitfield/i)
    await user.type(nameInputs[0], 'Priya Nair')
    const emailInputs = screen.getAllByPlaceholderText(/dwhitfield@…/i)
    await user.type(emailInputs[0], 'pnair@resortgroupinc.com')

    await user.click(screen.getByRole('button', { name: /create company/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0] as { contacts: Array<{ name: string; email: string }> }
    // Only the filled-in contact should survive
    expect(payload.contacts).toHaveLength(1)
    expect(payload.contacts[0].name).toBe('Priya Nair')
    expect(payload.contacts[0].email).toBe('pnair@resortgroupinc.com')
  })

  it('includes a contact that has a name but no email in the payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel(onSave)

    await user.type(screen.getByPlaceholderText(/alliant property management/i), 'Resort Management')

    const nameInputs = screen.getAllByPlaceholderText(/dana whitfield/i)
    await user.type(nameInputs[0], 'Name Only Contact')

    await user.click(screen.getByRole('button', { name: /create company/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const payload = onSave.mock.calls[0][0] as { contacts: Array<{ name: string }> }
    expect(payload.contacts).toHaveLength(1)
    expect(payload.contacts[0].name).toBe('Name Only Contact')
  })
})

describe('AddPMPanel — cancel', () => {
  it('"Cancel" button calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderPanel(vi.fn().mockResolvedValue(undefined), onClose)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ── Edit mode fixtures ────────────────────────────────────────────

const sampleCompany: ManagementCompany = {
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
  contacts: [
    {
      id: 'c1',
      name: 'Dana Whitfield',
      title: 'Community Association Manager',
      email: 'dwhitfield@alliantproperty.com',
      phone: '(239) 454-1108',
    },
  ],
}

function renderEditPanel(
  onUpdate = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn(),
  initialValues: ManagementCompany = sampleCompany,
  onAddContact = vi.fn().mockResolvedValue(undefined),
  onUpdateContact = vi.fn().mockResolvedValue(undefined),
  onDeleteContact = vi.fn().mockResolvedValue(undefined),
) {
  render(
    <AddPMPanel
      isOpen={true}
      onClose={onClose}
      onSave={vi.fn()}
      initialValues={initialValues}
      onUpdate={onUpdate}
      onAddContact={onAddContact}
      onUpdateContact={onUpdateContact}
      onDeleteContact={onDeleteContact}
    />,
  )
  return { onUpdate, onClose, onAddContact, onUpdateContact, onDeleteContact }
}

describe('AddPMPanel — edit mode', () => {
  it('shows "Edit management company" as the panel title instead of "Add management company"', () => {
    renderEditPanel()
    expect(screen.getByText(/edit management company/i)).toBeInTheDocument()
    expect(screen.queryByText(/add management company/i)).not.toBeInTheDocument()
  })

  it('shows "Save changes" as the submit button label instead of "Create company"', () => {
    renderEditPanel()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create company/i })).not.toBeInTheDocument()
  })

  it('pre-fills company_name input with the value from initialValues', () => {
    renderEditPanel()
    const nameInput = screen.getByPlaceholderText(/alliant property management/i) as HTMLInputElement
    expect(nameInput.value).toBe('Alliant Property Management')
  })

  it('pre-fills city and phone fields with values from initialValues', () => {
    renderEditPanel()
    const cityInput = screen.getByPlaceholderText(/fort myers/i) as HTMLInputElement
    const phoneInput = screen.getByPlaceholderText(/\(239\) 454-1101/i) as HTMLInputElement
    expect(cityInput.value).toBe('Fort Myers')
    expect(phoneInput.value).toBe('(239) 454-1101')
  })

  it('shows existing contacts in read-only display (contact name is visible as text)', () => {
    renderEditPanel()
    // Contact name is now in an editable input
    const nameInputs = screen.getAllByPlaceholderText(/dana whitfield/i) as HTMLInputElement[]
    expect(nameInputs.some((input) => input.value === 'Dana Whitfield')).toBe(true)
  })

  it('shows contact email in read-only display', () => {
    renderEditPanel()
    // Contact email is now in an editable input
    const emailInputs = screen.getAllByPlaceholderText(/dwhitfield@…/i) as HTMLInputElement[]
    expect(emailInputs.some((input) => input.value === 'dwhitfield@alliantproperty.com')).toBe(true)
  })

  it('shows "Add contact" button in edit mode', () => {
    renderEditPanel()
    expect(screen.getByRole('button', { name: /add contact/i })).toBeInTheDocument()
  })

  it('existing contact name is shown in an editable input field', () => {
    renderEditPanel()
    const nameInputs = screen.getAllByPlaceholderText(/dana whitfield/i) as HTMLInputElement[]
    const nameInput = nameInputs.find((input) => input.value === 'Dana Whitfield')
    expect(nameInput).toBeDefined()
    expect(nameInput!.tagName).toBe('INPUT')
  })

  it('can delete an existing contact row in edit mode', async () => {
    const user = userEvent.setup()
    renderEditPanel()

    // Confirm the contact row is initially present
    const nameInputsBefore = screen.getAllByPlaceholderText(/dana whitfield/i) as HTMLInputElement[]
    expect(nameInputsBefore.some((input) => input.value === 'Dana Whitfield')).toBe(true)

    await user.click(screen.getByRole('button', { name: /remove contact/i }))

    // After deletion, no input should have Dana Whitfield's value
    const nameInputsAfter = screen.queryAllByPlaceholderText(/dana whitfield/i) as HTMLInputElement[]
    expect(nameInputsAfter.every((input) => input.value !== 'Dana Whitfield')).toBe(true)
  })

  it('"Save changes" button still works and calls onUpdate with company fields', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderEditPanel(onUpdate)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    const payload = onUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(payload.company_name).toBe('Alliant Property Management')
  })

  it('shows "No contacts on file" when initialValues has an empty contacts array', () => {
    renderEditPanel(vi.fn(), vi.fn(), { ...sampleCompany, contacts: [] })
    expect(screen.getByText(/no contacts on file/i)).toBeInTheDocument()
  })

  it('submitting calls onUpdate with the company-level fields', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderEditPanel(onUpdate)

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    const payload = onUpdate.mock.calls[0][0] as Record<string, unknown>
    expect(payload.company_name).toBe('Alliant Property Management')
    expect(payload.city).toBe('Fort Myers')
  })

  it('submitting in edit mode never calls onSave', async () => {
    const onSave = vi.fn()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(
      <AddPMPanel
        isOpen={true}
        onClose={vi.fn()}
        onSave={onSave}
        initialValues={sampleCompany}
        onUpdate={onUpdate}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('create mode (no initialValues) shows "Add contact" button and calls onSave on submit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    // Standard create-mode render
    renderPanel(onSave)

    expect(screen.getByRole('button', { name: /add contact/i })).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/alliant property management/i), 'New Company')
    await user.click(screen.getByRole('button', { name: /create company/i }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
  })
})
