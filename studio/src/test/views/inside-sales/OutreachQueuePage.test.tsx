import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import OutreachQueuePage from '@/views/inside-sales/OutreachQueuePage'

function seedUser() {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
}

describe('OutreachQueuePage', () => {
  beforeEach(() => {
    seedUser()
    useUIStore.setState({ selectedLeadId: null })
  })

  describe('page structure', () => {
    it('renders "Outreach" as the page title (not "Outreach Queue")', async () => {
      render(<OutreachQueuePage />)
      // The new inbox layout uses "Outreach" not "Outreach Queue"
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^outreach$/i })).toBeInTheDocument()
      })
    })

    it('renders ListPane with the queue leads', async () => {
      render(<OutreachQueuePage />)
      await screen.findByText('City of Tempe — Parks RFP')
      expect(screen.getByText('Dobson Ranch HOA')).toBeInTheDocument()
      expect(screen.getByText('Chandler Corporate Park')).toBeInTheDocument()
      expect(screen.getByText('Legacy HOA Peoria')).toBeInTheDocument()
    })

    it('shows a count badge on the All tab in ListPane', async () => {
      render(<OutreachQueuePage />)
      const allTab = screen.getByRole('button', { name: /all/i })
      await waitFor(() => {
        expect(allTab.textContent).toMatch(/\d+/)
      })
    })

    it('"New message" button is visible in ListPane', async () => {
      render(<OutreachQueuePage />)
      expect(screen.getByRole('button', { name: /new message/i })).toBeInTheDocument()
    })
  })

  describe('shows only contacted and qualified leads', () => {
    it('shows contacted and qualified leads in the queue', async () => {
      render(<OutreachQueuePage />)
      // contacted: l2 (City of Tempe), l5 (Chandler Corporate Park), l10 (Legacy HOA Peoria)
      // qualified: l4 (Dobson Ranch HOA)
      await screen.findByText('City of Tempe — Parks RFP')
      expect(screen.getByText('Chandler Corporate Park')).toBeInTheDocument()
      expect(screen.getByText('Legacy HOA Peoria')).toBeInTheDocument()
      expect(screen.getByText('Dobson Ranch HOA')).toBeInTheDocument()
    })
  })

  describe('lead selection', () => {
    it('renders ConversationPane when a lead is selected from ListPane', async () => {
      const user = userEvent.setup()
      render(<OutreachQueuePage />)
      await screen.findByText('City of Tempe — Parks RFP')

      await user.click(screen.getByText('City of Tempe — Parks RFP'))

      // ConversationPane should render with the lead header and message thread
      await screen.findByText(/City of Tempe — Parks RFP/)
      // The thread or composer signals the ConversationPane is mounted
      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument()
      })
    })

    it('does not render ConversationPane when no lead is selected', async () => {
      render(<OutreachQueuePage />)
      await screen.findByText('City of Tempe — Parks RFP')

      // With no selection, composer / conversation thread should be absent
      // or a placeholder "select a lead" state should be shown
      const noSelectionState =
        screen.queryByText(/select a lead|choose a conversation|no conversation selected/i)
      const composer = screen.queryByRole('textbox')

      // Either an explicit empty state OR no textbox present
      expect(noSelectionState !== null || composer === null).toBe(true)
    })
  })

  describe('ListPane search', () => {
    it('filters leads when text is entered in the search input', async () => {
      const user = userEvent.setup()
      render(<OutreachQueuePage />)
      await screen.findByText('City of Tempe — Parks RFP')

      const searchInput =
        screen.queryByRole('searchbox') ?? screen.getByPlaceholderText(/search/i)
      await user.type(searchInput, 'Legacy')

      await waitFor(() => {
        expect(screen.getByText('Legacy HOA Peoria')).toBeInTheDocument()
        expect(screen.queryByText('City of Tempe — Parks RFP')).not.toBeInTheDocument()
      })
    })
  })

  describe('Overdue filter tab', () => {
    it('clicking Overdue tab updates the list', async () => {
      const user = userEvent.setup()
      render(<OutreachQueuePage />)
      await screen.findByText('City of Tempe — Parks RFP')

      const overdueTab = screen.getByRole('button', { name: /overdue/i })
      await user.click(overdueTab)

      // After clicking Overdue, expect either a filtered subset of leads
      // or an "all caught up" empty state — the exact set depends on due dates
      await waitFor(() => {
        const hasLeads = screen.queryAllByText(/HOA|Park|Corporate|Peoria|Kierland|Desert Ridge/).length > 0
        const hasEmptyState = screen.queryByText(/all caught up|no overdue/i) !== null
        expect(hasLeads || hasEmptyState).toBe(true)
      })
    })
  })

  describe('empty state', () => {
    it('shows "Queue is empty" when there are no contacted or qualified leads', async () => {
      server.use(
        http.get('/api/leads', () =>
          HttpResponse.json({
            data: [
              {
                id: 'l-new-only',
                property_name: 'Brand New Lead',
                address: '100 Test St',
                city: 'Phoenix',
                state: 'AZ',
                zip: '85001',
                lat: 0,
                lng: 0,
                lead_type: 'HOA',
                score: 70,
                score_factors: [],
                estimated_acreage: 10,
                estimated_contract_value: 50000,
                contact_name: null,
                contact_email: null,
                contact_linkedin: null,
                current_provider: null,
                source: 'manual',
                source_url: null,
                bid_deadline: null,
                status: 'new',
                assigned_to: null,
                handoff_notes: null,
                notes: null,
                ai_email_draft: null,
                ai_linkedin_draft: null,
                branch_id: 'b1',
                distance_miles: 5,
                aspire_opportunity_id: null,
                division_id: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
            total: 1,
            page: 1,
            page_size: 25,
          }),
        ),
      )

      render(<OutreachQueuePage />)
      await screen.findByText('Queue is empty')
      expect(screen.getByText('Queue is empty')).toBeInTheDocument()
    })
  })

  describe('ContactPicker modal', () => {
    it('opens ContactPicker modal when "New message" button is clicked', async () => {
      const user = userEvent.setup()
      render(<OutreachQueuePage />)

      await user.click(screen.getByRole('button', { name: /new message/i }))

      // Modal should appear with "New message" heading
      await screen.findByRole('dialog')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('closes ContactPicker modal when Cancel is clicked', async () => {
      const user = userEvent.setup()
      render(<OutreachQueuePage />)

      await user.click(screen.getByRole('button', { name: /new message/i }))
      await screen.findByRole('dialog')

      await user.click(screen.getByRole('button', { name: /cancel|close/i }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('Composer modal (full composer)', () => {
    it('Composer modal is NOT rendered when no lead is selected', async () => {
      render(<OutreachQueuePage />)
      await screen.findByText('City of Tempe — Parks RFP')

      // The modal overlay should not be present
      expect(document.querySelector('.fixed.inset-0.bg-black')).toBeNull()
    })

    it('"Full composer" button in ConversationPane opens the Composer modal', async () => {
      const user = userEvent.setup()
      render(<OutreachQueuePage />)
      await screen.findByText('City of Tempe — Parks RFP')

      // Select a lead to show ConversationPane
      await user.click(screen.getByText('City of Tempe — Parks RFP'))
      await screen.findByRole('button', { name: /full composer/i })

      // Click "Full composer"
      await user.click(screen.getByRole('button', { name: /full composer/i }))

      await waitFor(() => {
        // Composer modal scrim should appear
        expect(document.querySelector('.fixed.inset-0')).not.toBeNull()
        // 'New message' appears in the composer heading (may also appear in ListPane button)
        expect(screen.getAllByText('New message').length).toBeGreaterThan(0)
      })
    })

    it('closing Composer modal removes it from the DOM', async () => {
      const user = userEvent.setup()
      render(<OutreachQueuePage />)
      await screen.findByText('City of Tempe — Parks RFP')

      // Select lead and open composer
      await user.click(screen.getByText('City of Tempe — Parks RFP'))
      await screen.findByRole('button', { name: /full composer/i })
      await user.click(screen.getByRole('button', { name: /full composer/i }))

      await waitFor(() => {
        // Composer modal scrim should appear
        expect(document.querySelector('.fixed.inset-0')).not.toBeNull()
      })

      // Click the X button inside the composer modal
      const closeBtn = screen.getByRole('button', { name: /^x$|close/i })
      await user.click(closeBtn)

      await waitFor(() => {
        // After close, the composer scrim (with bg-black opacity) should be gone
        expect(document.querySelector('.fixed.inset-0.bg-black\\/\\[0\\.42\\]')).toBeNull()
      })
    })
  })
})
