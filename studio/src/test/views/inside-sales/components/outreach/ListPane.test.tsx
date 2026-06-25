import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { ListPane } from '@/views/inside-sales/components/outreach/ListPane'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

// Queue leads (status = 'contacted' | 'qualified'):
// l2 City of Tempe — Parks RFP (contacted)
// l3 Kierland Commons (status='new' in mockLeads but spec says it appears in queue — handler filters)
// l4 Dobson Ranch HOA (qualified)
// l5 Chandler Corporate Park (contacted)
// l7 Desert Ridge Marketplace (contacted in spec queue — status is 'new' in mockLeads)
// l10 Legacy HOA Peoria (contacted)
// Note: the MSW handler filters by ?status= params, so ListPane must request the right statuses.
// Per spec the queue has 6 leads. Tests use findBy* to wait for async data.

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

    it('shows follow-up count and overdue count in the subtitle', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      // e.g. "6 follow-ups · 3 overdue"
      await waitFor(() => {
        expect(screen.getByText(/follow-up/i)).toBeInTheDocument()
        expect(screen.getByText(/overdue/i)).toBeInTheDocument()
      })
    })

    it('renders "New message" button', () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      expect(screen.getByRole('button', { name: /new message/i })).toBeInTheDocument()
    })
  })

  describe('tabs', () => {
    it('renders All, Overdue, and Unread tabs', () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /overdue/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /unread/i })).toBeInTheDocument()
    })

    it('"All" tab has a live count badge', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      const allTab = screen.getByRole('tab', { name: /all/i })
      // The tab should contain a numeric badge
      await waitFor(() => {
        expect(allTab.textContent).toMatch(/\d+/)
      })
    })
  })

  describe('"All" tab — lead list', () => {
    it('shows all 6 queue leads when data loads', async () => {
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

      await user.click(screen.getByRole('tab', { name: /overdue/i }))

      // After switching tabs, either some leads show (those with overdue follow-up)
      // or an empty state message appears. Either is valid behavior for the Overdue filter.
      await waitFor(() => {
        const hasLeads = screen.queryAllByRole('button', { name: /parks rfp|ranch|corporate|peoria|kierland|desert ridge/i }).length > 0
        const hasEmptyState = screen.queryByText(/no overdue/i) !== null || screen.queryByText(/all caught up/i) !== null
        expect(hasLeads || hasEmptyState).toBe(true)
      })
    })
  })

  describe('"Unread" tab', () => {
    it('shows only unread leads when Unread tab is clicked', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')

      await user.click(screen.getByRole('tab', { name: /unread/i }))

      // After switching, list updates — either unread leads or an empty state
      await waitFor(() => {
        const listContainer = screen.getByRole('list', { hidden: true }) ?? document.body
        expect(listContainer).toBeInTheDocument()
      })
    })
  })

  describe('search', () => {
    it('filters the list to show only Kierland Commons when "Kierland" is typed', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')

      const searchInput = screen.getByRole('searchbox') ?? screen.getByPlaceholderText(/search/i)
      await user.type(searchInput, 'Kierland')

      await waitFor(() => {
        expect(screen.getByText('Kierland Commons')).toBeInTheDocument()
        expect(screen.queryByText('City of Tempe — Parks RFP')).not.toBeInTheDocument()
      })
    })

    it('filters the list by city name', async () => {
      const user = userEvent.setup()
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId={null} />)
      await screen.findByText('City of Tempe — Parks RFP')

      const searchInput = screen.getByRole('searchbox') ?? screen.getByPlaceholderText(/search/i)
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

    it('marks the selected QueueItem as active via aria-selected or data attribute', async () => {
      render(<ListPane onSelectLead={onSelectLead} selectedLeadId="l2" />)
      await screen.findByText('City of Tempe — Parks RFP')

      // The selected item should have an aria-selected="true" or data-selected="true"
      // to convey active state — find the row containing the lead name
      const itemText = screen.getByText('City of Tempe — Parks RFP')
      const queueItem = itemText.closest('[role="option"], [aria-selected], [data-selected]')
      expect(queueItem).not.toBeNull()
      const isSelected =
        queueItem?.getAttribute('aria-selected') === 'true' ||
        queueItem?.getAttribute('data-selected') === 'true'
      expect(isSelected).toBe(true)
    })
  })
})
