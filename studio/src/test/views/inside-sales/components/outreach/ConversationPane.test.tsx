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
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')
      expect(screen.getByText('City of Tempe — Parks RFP')).toBeInTheDocument()
    })

    it('renders the lead type badge in the header', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')
      // l2 is 'commercial' lead type
      expect(screen.getByText(/commercial/i)).toBeInTheDocument()
    })

    it('renders metric chips for estimated value and score', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')
      // Estimated contract value $420K and score 92 should appear as chips
      expect(screen.getByText(/420K|\$420/)).toBeInTheDocument()
      expect(screen.getByText(/92/)).toBeInTheDocument()
    })

    it('renders a "View lead" link or button in the header', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')
      expect(
        screen.queryByRole('link', { name: /view lead/i }) ??
        screen.getByRole('button', { name: /view lead/i })
      ).toBeInTheDocument()
    })
  })

  describe('channel filter pills', () => {
    it('renders channel filter pill buttons (not underline tabs)', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      // Pill buttons should have rounded-full class
      const allButton = screen.getByRole('button', { name: /^all$/i })
      expect(allButton.className).toMatch(/rounded-full/)
    })

    it('renders All, Email, Call, Text, Note, Meeting pills (no LinkedIn)', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      // There may be multiple Email/Text buttons (filter pills + dock toggle);
      // use getAllByRole and check at least one exists
      expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /^email$/i }).length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: /^call$/i })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /^text$/i }).length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: /^note$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^meeting$/i })).toBeInTheDocument()
    })

    it('does NOT render a LinkedIn filter pill', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      // LinkedIn should be completely absent from the filter area
      // (checking the channel filter area, not the whole doc)
      const filterArea = document.querySelector('[class*="flex gap-1"]')
      if (filterArea) {
        expect(filterArea.textContent).not.toMatch(/linkedin/i)
      } else {
        // fallback: just ensure no linkedin button exists
        expect(screen.queryByRole('button', { name: /^linkedin$/i })).not.toBeInTheDocument()
      }
    })
  })

  describe('message thread — "All" tab', () => {
    it('shows all messages for l2 in the thread', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('Intent to bid submitted.')
      expect(screen.getByText('Pre-bid questions submitted.')).toBeInTheDocument()
    })

    it('renders outbound bubbles for outbound messages', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('Intent to bid submitted.')
      // o2 is direction='out' email → renders as EmailCard with "Delivered" status
      expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0)
    })

    it('renders inbound bubbles for inbound messages', async () => {
      render(<ConversationPane leadId="l3" onOpenFullComposer={() => {}} />)
      // o8 is direction='in' email from Chris Abbott → renders as EmailCard with "to You · Email"
      await screen.findByText(/Thanks for reaching out/)
      expect(screen.getAllByText('Chris Abbott').length).toBeGreaterThan(0)
      expect(screen.getByText(/to You · Email/)).toBeInTheDocument()
    })

    it('shows all messages for l3 (mixed email + linkedin thread)', async () => {
      render(<ConversationPane leadId="l3" onOpenFullComposer={() => {}} />)
      // o7 (email out), o8 (email in), o9 (linkedin out)
      await screen.findByText(/Hi Chris, reaching out/)
      expect(screen.getByText(/Thanks for reaching out/)).toBeInTheDocument()
      expect(screen.getByText(/thanks for the email reply/i)).toBeInTheDocument()
    })
  })

  describe('channel filtering', () => {
    it('shows only email messages when Email pill is clicked', async () => {
      const user = userEvent.setup()
      render(<ConversationPane leadId="l3" onOpenFullComposer={() => {}} />)

      // Wait for all messages to load
      await screen.findByText(/Hi Chris, reaching out/)

      // There are multiple Email buttons (filter pill + dock toggle); click the first one (filter pill)
      const emailButtons = screen.getAllByRole('button', { name: /^email$/i })
      await user.click(emailButtons[0])

      await waitFor(() => {
        // o7 and o8 are email; o9 is linkedin
        expect(screen.getByText(/Hi Chris, reaching out/)).toBeInTheDocument()
        expect(screen.getByText(/Thanks for reaching out/)).toBeInTheDocument()
        // o9 linkedin message should be filtered out
        expect(screen.queryByText(/thanks for the email reply/i)).not.toBeInTheDocument()
      })
    })
  })

  describe('dock bar', () => {
    it('renders the dock bar with Email/Text segmented toggle', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      // The dock bar has Email and Text toggle buttons
      const emailToggle = screen.getAllByRole('button', { name: /^email$/i })
      const textToggle = screen.getAllByRole('button', { name: /^text$/i })
      expect(emailToggle.length).toBeGreaterThan(0)
      expect(textToggle.length).toBeGreaterThan(0)
    })

    it('renders a quick reply text input', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      const input = screen.getByPlaceholderText(/quick reply/i)
      expect(input).toBeInTheDocument()
    })

    it('renders a "Full composer" button in the dock bar', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      expect(screen.getByRole('button', { name: /full composer/i })).toBeInTheDocument()
    })

    it('clicking "Full composer" calls onOpenFullComposer prop', async () => {
      const user = userEvent.setup()
      let called = false
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => { called = true }} />)
      await screen.findByText('City of Tempe — Parks RFP')

      await user.click(screen.getByRole('button', { name: /full composer/i }))
      expect(called).toBe(true)
    })

    it('renders a Send button in the dock bar', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      expect(screen.getByRole('button', { name: /^send$/i })).toBeInTheDocument()
    })

    it('Send button is disabled when quick reply input is empty', async () => {
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      const sendBtn = screen.getByRole('button', { name: /^send$/i })
      expect(sendBtn).toBeDisabled()
    })

    it('typing in quick reply input and pressing Enter calls send', async () => {
      let postCalled = false
      server.use(
        http.post('/api/outreach/send', async () => {
          postCalled = true
          return HttpResponse.json({ success: true, message_id: 'msg_dock' })
        }),
      )

      const user = userEvent.setup()
      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)
      await screen.findByText('City of Tempe — Parks RFP')

      const input = screen.getByPlaceholderText(/quick reply/i)
      await user.type(input, 'Hello there{Enter}')

      await waitFor(() => {
        expect(postCalled).toBe(true)
      })
    })
  })

  describe('empty state', () => {
    it('shows an empty state message for leads with no outreach history', async () => {
      render(<ConversationPane leadId="l4" onOpenFullComposer={() => {}} />)
      await screen.findByText('Dobson Ranch HOA')

      // l4 has no outreach history — expect a prompt to start the conversation
      await screen.findByText(/start the conversation|no messages yet/i)
      expect(screen.getByText(/start the conversation|no messages yet/i)).toBeInTheDocument()
    })
  })

  describe('overdue divider', () => {
    it('shows "Follow-up overdue" divider when lead has an overdue follow-up', async () => {
      // l5 (Chandler Corporate Park) has o4 with next_follow_up in the past
      render(<ConversationPane leadId="l5" onOpenFullComposer={() => {}} />)
      await screen.findByText('Chandler Corporate Park')

      await waitFor(() => {
        // May appear in both header chip and divider; check at least one exists
        expect(screen.getAllByText(/follow-up overdue/i).length).toBeGreaterThan(0)
      })
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

      render(<ConversationPane leadId="l2" onOpenFullComposer={() => {}} />)

      // Skeleton elements should be present immediately before the data resolves
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
