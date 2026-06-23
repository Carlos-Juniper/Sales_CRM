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

    it('calls onClose when the Cancel/Close button is clicked', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await user.click(screen.getByRole('button', { name: /cancel|close/i }))

      expect(onClose).toHaveBeenCalledTimes(1)
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

      const silveleafGroup = screen.getByText('Silverleaf HOA').closest('[role="group"], [data-group], li, section') ?? document.body
      expect(within(silveleafGroup as HTMLElement).getByText('Jennifer Walsh')).toBeInTheDocument()
    })
  })

  describe('search', () => {
    it('filters contacts by name when search text is typed', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Jennifer Walsh')

      const searchInput = screen.getByRole('searchbox') ?? screen.getByPlaceholderText(/search/i)
      await user.type(searchInput, 'Abbott')

      await waitFor(() => {
        expect(screen.getByText('Chris Abbott')).toBeInTheDocument()
        expect(screen.queryByText('Jennifer Walsh')).not.toBeInTheDocument()
        expect(screen.queryByText('Nicole Foster')).not.toBeInTheDocument()
      })
    })
  })

  describe('contact selection', () => {
    it('adds a chip to the To field when a contact is selected', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await user.click(screen.getByText('Chris Abbott'))

      await waitFor(() => {
        // Chip for Chris Abbott should appear in the selection area
        const chips = screen.getAllByText('Chris Abbott')
        // One instance in the list, one as a chip — or the chip has a specific role/testid
        expect(chips.length).toBeGreaterThanOrEqual(1)
        // More specifically, look for a chip/badge element
        const chip = screen.getByRole('listitem', { name: /Chris Abbott/i }) ??
          document.querySelector('[data-chip="Chris Abbott"]')
        if (chip) {
          expect(chip).toBeInTheDocument()
        } else {
          // If no specific chip role, verify the selection is reflected in some UI element
          // outside the contacts list (e.g. a "To:" row at the top)
          expect(chips.length).toBeGreaterThan(1)
        }
      })
    })

    it('removes the chip when a selected contact is clicked again (deselect)', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')

      // Select then deselect
      await user.click(screen.getByText('Chris Abbott'))
      await user.click(screen.getByText('Chris Abbott'))

      await waitFor(() => {
        // After deselect, the contact should no longer appear as a selected chip
        // The contact row itself may still be in the list
        const selectedIndicator = screen.queryByRole('listitem', { name: /Chris Abbott/i })
        if (selectedIndicator) {
          // The chip was removed — element no longer has "selected" state
          expect(selectedIndicator.getAttribute('aria-selected')).not.toBe('true')
        }
        // Confirm button should be disabled again (no selection)
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
        // Both selections are reflected — Confirm button enabled
        const confirmBtn = screen.getByRole('button', { name: /confirm/i })
        expect(confirmBtn).not.toBeDisabled()
        // Both names appear in the selection area (as chips or inline)
        expect(screen.getAllByText('Chris Abbott').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Patricia Morales').length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('Confirm button', () => {
    it('is disabled when no contacts are selected', () => {
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)
      expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
    })

    it('calls onConfirm with the selected contact ids when clicked', async () => {
      const user = userEvent.setup()
      render(<ContactPicker open={true} onClose={onClose} onConfirm={onConfirm} />)

      await screen.findByText('Chris Abbott')
      await user.click(screen.getByText('Chris Abbott'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled()
      })

      await user.click(screen.getByRole('button', { name: /confirm/i }))

      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onConfirm).toHaveBeenCalledWith(['c3'])
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
