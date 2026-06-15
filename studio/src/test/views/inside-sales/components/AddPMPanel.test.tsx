import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { AddPMPanel } from '@/views/inside-sales/components/accounts/AddPMPanel'

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
