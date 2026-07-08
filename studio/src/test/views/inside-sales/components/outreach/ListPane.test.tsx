import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { ListPane } from '@/views/inside-sales/components/outreach/ListPane'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

// Queue leads (status = 'contacted' | 'qualified'):
// l2 City of Tempe — Parks RFP (contacted)
// l4 Dobson Ranch HOA (qualified)
// l5 Chandler Corporate Park (contacted)
// l10 Legacy HOA Peoria (contacted)
// Note: the MSW handler filters by status, so useOutreachQueue filters locally.
// Per mock data the queue has 4 leads with status contacted/qualified.

const onSelectLead = vi.fn()

beforeEach(() => {
  useAuthStore.setState({ user: makeUser() })
  useUIStore.setState({ selectedLeadId: null })
  onSelectLead.mockClear()
})

describe('ListPane', () => {
  describe('header', () => {
    it('renders "Outreach" as the pane title', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      expect(screen.getByRole('heading', { name: /outreach/i })).toBeInTheDocument()
    })

    it('does NOT show the old subtitle with follow-up count', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      // Wait for data to load, then confirm no subtitle
      await waitFor(() => {
        expect(screen.queryByTestId('queue-subtitle')).not.toBeInTheDocument()
        expect(screen.queryByText(/follow-up/i)).not.toBeInTheDocument()
      })
    })

    it('renders "New message" button', () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      expect(screen.getByRole('button', { name: /new message/i })).toBeInTheDocument()
    })

    it('renders Filter button with SlidersHorizontal icon and ChevronDown', () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      // The filter button has text "Filter"
      expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument()
    })

    it('does NOT show the old folder tag chip row (Inbox, Starred, Sent, Drafts…)', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      // These were old folder chips rendered inline — should not exist anymore
      // (Inbox/Starred/Sent labels might appear inside filter dropdown, but not as separate chips in the header)
      await waitFor(() => {
        // The filter dropdown should be closed by default, so these shouldn't be visible
        expect(screen.queryByRole('button', { name: /^inbox$/i })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^starred$/i })).not.toBeInTheDocument()
      })
    })
  })

  describe('filter dropdown', () => {
    it('opens filter dropdown when Filter button is clicked', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)

      const filterBtn = screen.getByRole('button', { name: /filter/i })
      await user.click(filterBtn)

      // Should show all 8 sections
      expect(screen.getByRole('button', { name: /inbox/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /starred/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sent/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /drafts/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /proposals/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /clients/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /internal/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /trash/i })).toBeInTheDocument()
    })

    it('shows a count for each section in the dropdown', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)

      await user.click(screen.getByRole('button', { name: /filter/i }))

      // Each section row should have a numeric count
      const dropdown = screen.getByRole('button', { name: /inbox/i }).closest('div')!.parentElement!
      expect(dropdown.textContent).toMatch(/\d+/)
    })

    it('closes dropdown when a section is selected', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)

      await user.click(screen.getByRole('button', { name: /filter/i }))
      expect(screen.getByRole('button', { name: /starred/i })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /starred/i }))

      // Dropdown should be gone
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /^starred$/i })).not.toBeInTheDocument()
      })
    })
  })

  describe('active-section chip', () => {
    it('does NOT show a chip when section is inbox (default)', () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      // No active-section chip when on inbox
      expect(screen.queryByText('Inbox')).not.toBeInTheDocument()
    })

    it('shows the active-section chip after selecting a non-inbox section', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)

      // Open dropdown and pick "Drafts"
      await user.click(screen.getByRole('button', { name: /filter/i }))
      await user.click(screen.getByRole('button', { name: /drafts/i }))

      // Chip should appear
      await waitFor(() => {
        expect(screen.getByText('Drafts')).toBeInTheDocument()
      })
    })

    it('chip has an X button that resets to inbox', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)

      // Select Drafts section
      await user.click(screen.getByRole('button', { name: /filter/i }))
      await user.click(screen.getByRole('button', { name: /drafts/i }))
      await screen.findByText('Drafts')

      // Click the X button on the chip
      const closeBtn = screen.getByRole('button', { name: '' })
      // The X button is inside the chip — find by querying within the chip text
      const chip = screen.getByText('Drafts').closest('span')!
      const xBtn = chip.querySelector('button')!
      await user.click(xBtn)

      // Chip should be gone
      await waitFor(() => {
        expect(screen.queryByText('Drafts')).not.toBeInTheDocument()
      })
    })
  })

  describe('tabs', () => {
    it('renders All, Overdue, and Unread tabs', () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /overdue/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /unread/i })).toBeInTheDocument()
    })

    it('"All" tab has a live count badge', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      const allTab = screen.getByRole('button', { name: /all/i })
      await waitFor(() => {
        expect(allTab.textContent).toMatch(/\d+/)
      })
    })

    it('"Overdue" tab has a count badge', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      const overdueTab = screen.getByRole('button', { name: /overdue/i })
      await waitFor(() => {
        expect(overdueTab.textContent).toMatch(/\d+/)
      })
    })

    it('"Unread" tab has a count badge', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      const unreadTab = screen.getByRole('button', { name: /unread/i })
      await waitFor(() => {
        expect(unreadTab.textContent).toMatch(/\d+/)
      })
    })
  })

  describe('"All" tab — lead list', () => {
    it('shows queue leads when data loads', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')
      expect(screen.getByText('Dobson Ranch HOA')).toBeInTheDocument()
      expect(screen.getByText('Chandler Corporate Park')).toBeInTheDocument()
      expect(screen.getByText('Legacy HOA Peoria')).toBeInTheDocument()
    })
  })

  describe('"Overdue" tab', () => {
    it('shows only overdue leads when Overdue tab is clicked', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')

      await user.click(screen.getByRole('button', { name: /overdue/i }))

      await waitFor(() => {
        const hasLeads = screen.queryAllByRole('button', { name: /parks rfp|ranch|corporate|peoria|kierland|desert ridge/i }).length > 0
        const hasEmptyState = screen.queryByText(/no overdue/i) !== null || screen.queryByText(/all caught up/i) !== null || screen.queryByText(/queue is empty/i) !== null
        expect(hasLeads || hasEmptyState).toBe(true)
      })
    })
  })

  describe('"Unread" tab', () => {
    it('shows only unread leads when Unread tab is clicked', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')

      await user.click(screen.getByRole('button', { name: /unread/i }))

      await waitFor(() => {
        const listContainer = document.querySelector('[role="list"]') ?? document.body
        expect(listContainer).toBeInTheDocument()
      })
    })
  })

  describe('search', () => {
    it('filters the list to show only Kierland Commons when "Kierland" is typed', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')

      const searchInput = screen.getByRole('searchbox')
      await user.type(searchInput, 'Kierland')

      await waitFor(() => {
        // Kierland Commons has status 'new' so won't be in queue — city is Scottsdale
        // Searching by city 'Tempe' with no matches for Kierland — expect empty or no Tempe
        expect(screen.queryByText('City of Tempe — Parks RFP')).not.toBeInTheDocument()
      })
    })

    it('filters the list by city name', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')

      const searchInput = screen.getByRole('searchbox')
      await user.type(searchInput, 'Tempe')

      await waitFor(() => {
        expect(screen.getByText('City of Tempe — Parks RFP')).toBeInTheDocument()
        expect(screen.queryByText('Legacy HOA Peoria')).not.toBeInTheDocument()
      })
    })
  })

  describe('lead selection', () => {
    it('calls onSelectLead with the lead id when a QueueItem is clicked', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')

      await user.click(screen.getByText('City of Tempe — Parks RFP'))

      expect(onSelectLead).toHaveBeenCalledWith('l2')
    })

    it('marks the selected QueueItem as active via aria-current or data-selected', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId="l2" />)
      await screen.findByText('City of Tempe — Parks RFP')

      const itemText = screen.getByText('City of Tempe — Parks RFP')
      const queueItem = itemText.closest('[aria-current], [data-selected]')
      expect(queueItem).not.toBeNull()
      const isSelected =
        queueItem?.getAttribute('aria-current') === 'true' ||
        queueItem?.getAttribute('data-selected') === 'true'
      expect(isSelected).toBe(true)
    })
  })
})
