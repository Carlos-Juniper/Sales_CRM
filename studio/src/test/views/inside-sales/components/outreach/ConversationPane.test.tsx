import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { ConversationPane } from '@/views/inside-sales/components/outreach/ConversationPane'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'

// Thread data from mockOutreach:
// l2: o2 (email, out, "Intent to bid submitted."), o3 (email, out, "Pre-bid questions submitted.")
// l3: o7 (email, out), o8 (email, IN, Chris Abbott), o9 (linkedin, out)
// l4: no history (Dobson Ranch)
// l7: o10 (email, out), o11 (email, IN, Nicole Foster), o12 (email, out)

beforeEach(() => {
  useAuthStore.setState({ user: makeUser() })
  useUIStore.setState({ selectedLeadId: null })
})

describe('ConversationPane', () => {
  describe('header', () => {
    it('renders the property name in the header', async () => {
      render(<ConversationPane leadId="l2" />)
      await screen.findByText('City of Tempe — Parks RFP')
      expect(screen.getByText('City of Tempe — Parks RFP')).toBeInTheDocument()
    })

    it('renders the lead type badge in the header', async () => {
      render(<ConversationPane leadId="l2" />)
      await screen.findByText('City of Tempe — Parks RFP')
      // l2 is 'commercial' lead type
      expect(screen.getByText(/commercial/i)).toBeInTheDocument()
    })

    it('renders metric chips for estimated value and score', async () => {
      render(<ConversationPane leadId="l2" />)
      await screen.findByText('City of Tempe — Parks RFP')
      // Estimated contract value $420K and score 92 should appear as chips
      expect(screen.getByText(/420K|\$420/)).toBeInTheDocument()
      expect(screen.getByText(/92/)).toBeInTheDocument()
    })

    it('renders a "View lead" link or button in the header', async () => {
      render(<ConversationPane leadId="l2" />)
      await screen.findByText('City of Tempe — Parks RFP')
      expect(screen.getByRole('link', { name: /view lead/i }) ?? screen.getByRole('button', { name: /view lead/i })).toBeInTheDocument()
    })
  })

  describe('channel filter tabs', () => {
    it('renders All, Email, LinkedIn, and Call channel tabs', async () => {
      render(<ConversationPane leadId="l2" />)
      await screen.findByText('City of Tempe — Parks RFP')

      // Exact match on "All" so it does not also match "Call".
      expect(screen.getByRole('tab', { name: /^all$/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /email/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /linkedin/i })).toBeInTheDocument()
      // The former "phone"/"Text" channel is now the "Call" channel.
      expect(screen.getByRole('tab', { name: /^call$/i })).toBeInTheDocument()
    })
  })

  describe('message thread — "All" tab', () => {
    it('shows all messages for l2 in the thread', async () => {
      render(<ConversationPane leadId="l2" />)
      await screen.findByText('Intent to bid submitted.')
      expect(screen.getByText('Pre-bid questions submitted.')).toBeInTheDocument()
    })

    it('renders outbound bubbles for outbound messages', async () => {
      render(<ConversationPane leadId="l2" />)
      await screen.findByText('Intent to bid submitted.')
      // o2 is direction='out' email → renders as EmailCard with "Delivered" status
      expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0)
    })

    it('renders inbound bubbles for inbound messages', async () => {
      render(<ConversationPane leadId="l3" />)
      // o8 is direction='in' email from Chris Abbott → renders as EmailCard with "to You · Email"
      await screen.findByText(/Thanks for reaching out/)
      expect(screen.getByText('Chris Abbott')).toBeInTheDocument()
      expect(screen.getByText(/to You · Email/)).toBeInTheDocument()
    })

    it('shows all messages for l3 (mixed email + linkedin thread)', async () => {
      render(<ConversationPane leadId="l3" />)
      // o7 (email out), o8 (email in), o9 (linkedin out)
      await screen.findByText(/Hi Chris, reaching out/)
      expect(screen.getByText(/Thanks for reaching out/)).toBeInTheDocument()
      expect(screen.getByText(/thanks for the email reply/i)).toBeInTheDocument()
    })
  })

  describe('channel filtering', () => {
    it('shows only email messages when Email tab is clicked', async () => {
      const user = userEvent.setup()
      render(<ConversationPane leadId="l3" />)

      // Wait for all messages to load
      await screen.findByText(/Hi Chris, reaching out/)

      await user.click(screen.getByRole('tab', { name: /email/i }))

      await waitFor(() => {
        // o7 and o8 are email; o9 is linkedin
        expect(screen.getByText(/Hi Chris, reaching out/)).toBeInTheDocument()
        expect(screen.getByText(/Thanks for reaching out/)).toBeInTheDocument()
        // o9 linkedin message should be filtered out
        expect(screen.queryByText(/thanks for the email reply/i)).not.toBeInTheDocument()
      })
    })

    it('shows only linkedin messages when LinkedIn tab is clicked', async () => {
      const user = userEvent.setup()
      render(<ConversationPane leadId="l3" />)

      await screen.findByText(/Hi Chris, reaching out/)

      await user.click(screen.getByRole('tab', { name: /linkedin/i }))

      await waitFor(() => {
        // o9 is the only linkedin message
        expect(screen.getByText(/thanks for the email reply/i)).toBeInTheDocument()
        // o7 (email out) should be filtered out
        expect(screen.queryByText(/Hi Chris, reaching out/)).not.toBeInTheDocument()
      })
    })
  })

  describe('empty state', () => {
    it('shows an empty state message for leads with no outreach history', async () => {
      render(<ConversationPane leadId="l4" />)
      await screen.findByText('Dobson Ranch HOA')

      // l4 has no outreach history — expect a prompt to start the conversation
      await screen.findByText(/start the conversation|no messages yet/i)
      expect(screen.getByText(/start the conversation|no messages yet/i)).toBeInTheDocument()
    })
  })

  describe('overdue divider', () => {
    it('shows "Follow-up overdue" divider when lead has an overdue follow-up', async () => {
      // l5 (Chandler Corporate Park) has o4 with next_follow_up in the past
      // Override to use l5 which has an overdue follow-up date
      render(<ConversationPane leadId="l5" />)
      await screen.findByText('Chandler Corporate Park')

      await waitFor(() => {
        expect(screen.getByText(/follow-up overdue/i)).toBeInTheDocument()
      })
    })
  })

  describe('composer', () => {
    it('renders the Composer at the bottom of the pane', async () => {
      render(<ConversationPane leadId="l2" />)
      await screen.findByText('City of Tempe — Parks RFP')

      // Composer renders a textarea for message input
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('loading state', () => {
    it('shows skeleton elements while lead data is loading', async () => {
      // Introduce a delay to observe the loading state before data resolves
      server.use(
        http.get('/api/leads/l2', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return HttpResponse.json({
            id: 'l2',
            property_name: 'City of Tempe — Parks RFP',
            address: '31 E 5th St',
            city: 'Tempe',
            state: 'AZ',
            zip: '85281',
            lat: 33.42,
            lng: -111.94,
            lead_type: 'commercial',
            score: 92,
            score_factors: [],
            estimated_acreage: 120,
            estimated_contract_value: 420000,
            contact_name: 'Mark Benson',
            contact_email: 'mbenson@tempe.gov',
            contact_linkedin: null,
            current_provider: null,
            source: 'sam_gov',
            source_url: null,
            bid_deadline: null,
            status: 'contacted',
            assigned_to: null,
            handoff_notes: null,
            notes: null,
            ai_email_draft: null,
            ai_linkedin_draft: null,
            branch_id: 'b1',
            distance_miles: 5.2,
            aspire_opportunity_id: null,
            division_id: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        }),
      )

      render(<ConversationPane leadId="l2" />)

      // Skeleton elements should be present immediately before the data resolves
      // Accept either skeleton-specific attributes or animate-pulse class convention
      const skeleton =
        document.querySelector('[data-testid*="skeleton"]') ??
        document.querySelector('[class*="skeleton"]') ??
        document.querySelector('[class*="animate-pulse"]') ??
        document.querySelector('[aria-busy="true"]')

      expect(skeleton).not.toBeNull()

      // Cleanup: wait for data to fully load
      await screen.findByText('City of Tempe — Parks RFP')
    })
  })
})
