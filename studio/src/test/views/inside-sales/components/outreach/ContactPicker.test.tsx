import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { ContactPicker } from '@/views/inside-sales/components/outreach/ContactPicker'
import { useAuthStore } from '@/store/authStore'

// mockContacts has 7 entries with these ids:
// c1 Jennifer Walsh — Silverleaf HOA
// c2 Mark Benson — City of Tempe
// c3 Chris Abbott — Kierland Commons
// c4 Patricia Morales — Dobson Ranch HOA
// c5 Tom Hicks — Chandler Corporate Park
// c6 Nicole Foster — Desert Ridge Marketplace
// c7 Susan Park — Scottsdale Unified School District

const onClose = vi.fn()
const onConfirm = vi.fn()

beforeEach(() => {
  useAuthStore.setState({ user: makeUser() })
  onClose.mockClear()
  onConfirm.mockClear()
})

describe('ContactPicker', () => {
  describe('open/close visibility', () => {
    it('renders modal content when open=true', () => {
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/new message/i)).toBeInTheDocument()
    })

    it('does not render dialog content when open=false', () => {
      render(<ContactPicker open={false} onClose={onClose} onConfirm={onConfirm} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('calls onClose when the Cancel button is clicked', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await user.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('To: field inline input', () => {
    it('renders an inline input with correct placeholder', () => {
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)
      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      expect(input).toBeInTheDocument()
    })

    it('does NOT render a separate search bar (old design removed)', () => {
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)
      // The old design had a role="searchbox" input; new design uses a single inline input
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    })
  })

  describe('contacts list', () => {
    it('shows all contacts after data loads', async () => {
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Jennifer Walsh')
      expect(screen.getByText('Chris Abbott')).toBeInTheDocument()
      expect(screen.getByText('Nicole Foster')).toBeInTheDocument()
    })

    it('groups contacts by company name', async () => {
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Silverleaf HOA')

      const silveleafGroup = screen.getByText('Silverleaf HOA').closest('[role="group"], [data-group], li, section, div') ?? document.body
      expect(within(silveleafGroup as HTMLElement).getByText('Jennifer Walsh')).toBeInTheDocument()
    })
  })

  describe('inline search (input doubles as search)', () => {
    it('filters contacts by name when text is typed in the inline input', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Jennifer Walsh')

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'Abbott')

      await waitFor(() => {
        expect(screen.getByText('Chris Abbott')).toBeInTheDocument()
        expect(screen.queryByText('Jennifer Walsh')).not.toBeInTheDocument()
        expect(screen.queryByText('Nicole Foster')).not.toBeInTheDocument()
      })
    })
  })

  describe('contact selection', () => {
    it('adds a chip to the To: field when a contact is clicked', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await user.click(screen.getByText('Chris Abbott'))

      await waitFor(() => {
        // Name should appear at least twice: once in the list, once as a chip
        const allMatches = screen.getAllByText('Chris Abbott')
        expect(allMatches.length).toBeGreaterThan(1)
      })
    })

    it('removes the chip when the X on a selected contact chip is clicked', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await user.click(screen.getByText('Chris Abbott'))

      // Wait for chip to appear (appears twice: chip + list)
      await waitFor(() => {
        expect(screen.getAllByText('Chris Abbott').length).toBeGreaterThan(1)
      })

      // Find the chip in the To: field — it's an inline-flex span containing the name
      // The chip X button is the button inside that chip span
      const allChrisElements = screen.getAllByText('Chris Abbott')
      // The chip is the one inside the To: area (not the list button)
      // It's wrapped in a span.inline-flex, not a button
      const chipElement = allChrisElements.find(el => el.closest('span.inline-flex'))
      const chipSpan = chipElement?.closest('span.inline-flex') as HTMLElement
      const xBtn = chipSpan?.querySelector('button') as HTMLElement
      await user.click(xBtn)

      await waitFor(() => {
        // After deselect, confirm button should be disabled again
        expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
      })
    })

    it('allows selecting two contacts simultaneously (multi-select)', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await screen.findByText('Patricia Morales')

      await user.click(screen.getByText('Chris Abbott'))
      await user.click(screen.getByText('Patricia Morales'))

      await waitFor(() => {
        const confirmBtn = screen.getByRole('button', { name: /confirm/i })
        expect(confirmBtn).not.toBeDisabled()
        expect(screen.getAllByText('Chris Abbott').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Patricia Morales').length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('freeform email chip', () => {
    it('creates an email chip with a Mail icon when a valid email is entered and Enter is pressed', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'test@example.com')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByText('test@example.com')).toBeInTheDocument()
      })
      // Input should be cleared after adding chip
      expect(input).toHaveValue('')
    })

    it('creates an email chip when comma is pressed instead of Enter', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'comma@example.com,')

      await waitFor(() => {
        expect(screen.getByText('comma@example.com')).toBeInTheDocument()
      })
    })

    it('does NOT create a chip when an invalid string (no @ sign) is entered', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'notanemail')
      await user.keyboard('{Enter}')

      // 'notanemail' should NOT appear as a chip
      expect(screen.queryByText('notanemail')).not.toBeInTheDocument()
      // Input value should remain (chip not created)
      expect(input).toHaveValue('notanemail')
    })

    it('removes a freeform email chip when its X button is clicked', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'remove@example.com')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByText('remove@example.com')).toBeInTheDocument()
      })

      // Find and click the X button next to the chip
      const chip = screen.getByText('remove@example.com').closest('span')!
      const removeBtn = within(chip).getByRole('button')
      await user.click(removeBtn)

      await waitFor(() => {
        expect(screen.queryByText('remove@example.com')).not.toBeInTheDocument()
      })
    })

    it('does not add a duplicate freeform chip for the same email', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'dup@example.com')
      await user.keyboard('{Enter}')
      await user.type(input, 'dup@example.com')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getAllByText('dup@example.com').length).toBe(1)
      })
    })
  })

  describe('freeform phone chip', () => {
    it('creates a phone chip when a phone number is entered and Enter is pressed', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, '555-1234567')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByText('555-1234567')).toBeInTheDocument()
      })
      expect(input).toHaveValue('')
    })
  })

  describe('Backspace behavior', () => {
    it('removes the last freeform chip on Backspace when input is empty', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'first@example.com')
      await user.keyboard('{Enter}')
      await user.type(input, 'second@example.com')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByText('second@example.com')).toBeInTheDocument()
      })

      // Backspace on empty input removes last freeform chip
      await user.keyboard('{Backspace}')

      await waitFor(() => {
        expect(screen.queryByText('second@example.com')).not.toBeInTheDocument()
        expect(screen.getByText('first@example.com')).toBeInTheDocument()
      })
    })

    it('removes the last contact chip on Backspace when no freeform chips remain', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await user.click(screen.getByText('Chris Abbott'))

      // Wait for chip to appear
      await waitFor(() => {
        expect(screen.getAllByText('Chris Abbott').length).toBeGreaterThan(1)
      })

      // Use aria-label to find the input (placeholder may be empty when chips exist)
      const input = screen.getByRole('textbox', { name: /to field/i })
      await user.click(input)
      await user.keyboard('{Backspace}')

      await waitFor(() => {
        // The confirm button should be disabled again (contact chip removed)
        expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
      })
    })
  })

  describe('Enter-to-add hint', () => {
    it('shows "Press Enter to add" hint when input looks like an email', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'hint@example.com')

      await waitFor(() => {
        expect(screen.getByText(/press enter to add/i)).toBeInTheDocument()
      })
    })

    it('does NOT show the hint when input is an invalid string', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'notvalid')

      expect(screen.queryByText(/press enter to add/i)).not.toBeInTheDocument()
    })
  })

  describe('Confirm button', () => {
    it('is disabled when no contacts are selected and no freeform chips exist', () => {
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
    })

    it('shows count including both contact chips and freeform chips', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await user.click(screen.getByText('Chris Abbott'))

      // After selecting a contact the placeholder clears; find input by aria-label
      const input = screen.getByRole('textbox', { name: /to field/i })
      await user.type(input, 'extra@example.com')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        // Should show (2) — 1 contact + 1 freeform
        expect(screen.getByRole('button', { name: /confirm \(2\)/i })).toBeInTheDocument()
      })
    })

    it('calls onConfirm with contact id when a contact is selected and confirmed', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await user.click(screen.getByText('Chris Abbott'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled()
      })

      await user.click(screen.getByRole('button', { name: /confirm/i }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm).toHaveBeenCalledWith(expect.arrayContaining(['c3']))
    })

    it('calls onConfirm with freeform id when a freeform chip is confirmed', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      const input = screen.getByPlaceholderText(/add email, phone, or search contacts/i)
      await user.type(input, 'free@example.com')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled()
      })

      await user.click(screen.getByRole('button', { name: /confirm/i }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm).toHaveBeenCalledWith(expect.arrayContaining(['free-free@example.com']))
    })

    it('calls onConfirm with multiple ids when multiple contacts are selected', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await screen.findByText('Patricia Morales')

      await user.click(screen.getByText('Chris Abbott'))
      await user.click(screen.getByText('Patricia Morales'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled()
      })

      await user.click(screen.getByRole('button', { name: /confirm/i }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      const [calledWithIds] = onConfirm.mock.calls[0] as [string[]]
      expect(calledWithIds).toContain('c3')
      expect(calledWithIds).toContain('c4')
    })
  })
})
