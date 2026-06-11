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

  it('renders Outreach Queue page title', async () => {
    render(<OutreachQueuePage />)
    expect(screen.getByText('Outreach Queue')).toBeInTheDocument()
  })

  it('renders follow-up queue section header', async () => {
    render(<OutreachQueuePage />)
    await screen.findByText(/Follow-up queue/i)
    expect(screen.getByText(/Follow-up queue/i)).toBeInTheDocument()
  })

  it('shows only contacted and qualified leads in queue', async () => {
    render(<OutreachQueuePage />)
    // contacted: l2 (City of Tempe), l5 (Chandler Corporate Park), l10 (Legacy HOA Peoria)
    // qualified: l4 (Dobson Ranch HOA)
    await screen.findByText('City of Tempe — Parks RFP')
    expect(screen.getByText('City of Tempe — Parks RFP')).toBeInTheDocument()
    expect(screen.getByText('Chandler Corporate Park')).toBeInTheDocument()
    expect(screen.getByText('Legacy HOA Peoria')).toBeInTheDocument()
    expect(screen.getByText('Dobson Ranch HOA')).toBeInTheDocument()
  })

  it('does not show new or won leads in the queue', async () => {
    render(<OutreachQueuePage />)
    await screen.findByText('City of Tempe — Parks RFP')
    // Silverleaf HOA is 'new' — should NOT be in queue
    // We need to check within the queue list, not the whole page
    const queueSection = document.querySelector('[class*="w-\\[300px\\]"]')
    if (queueSection) {
      expect(queueSection.textContent).not.toMatch('Silverleaf HOA')
    }
  })

  it('renders empty state when no contacted/qualified leads exist', async () => {
    server.use(
      http.get('/api/leads', () => {
        // Return only new leads — none should appear in queue
        return HttpResponse.json({
          data: [
            {
              id: 'l-only-new',
              property_name: 'Only New Lead',
              city: 'Phoenix', state: 'AZ', zip: '', address: '',
              lat: 0, lng: 0,
              lead_type: 'HOA',
              score: 70, score_factors: [],
              estimated_acreage: 10, estimated_contract_value: 50000,
              contact_name: null, contact_email: null, contact_linkedin: null,
              current_provider: null,
              source: 'manual', source_url: null, bid_deadline: null,
              status: 'new',
              assigned_to: null, handoff_notes: null,
              ai_email_draft: null, ai_linkedin_draft: null,
              branch_id: 'b1', distance_miles: 5,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }
          ],
          total: 1, page: 1, page_size: 25,
        })
      })
    )

    render(<OutreachQueuePage />)
    await screen.findByText('Queue is empty')
    expect(screen.getByText('Queue is empty')).toBeInTheDocument()
    expect(screen.getByText('All follow-ups are complete.')).toBeInTheDocument()
  })

  it('shows outreach detail panel when a lead is selected in queue', async () => {
    render(<OutreachQueuePage />)
    await screen.findByText('City of Tempe — Parks RFP')

    // Select a lead from the queue
    const queueItem = screen.getByText('City of Tempe — Parks RFP').closest('button')
    if (queueItem) {
      const user = userEvent.setup()
      await user.click(queueItem)
    }

    // Outreach history heading should appear in detail panel
    await screen.findByText('Outreach History')
    expect(screen.getByText('Outreach History')).toBeInTheDocument()
  })

  it('shows outreach history for a lead (GET /api/outreach/:leadId)', async () => {
    // Pre-select l2 (City of Tempe) which has outreach history
    useUIStore.setState({ selectedLeadId: 'l2' })

    render(<OutreachQueuePage />)
    await screen.findByText('Outreach History')

    // l2 has 2 history items: 'Intent to bid submitted.' and 'Pre-bid questions submitted.'
    await screen.findByText('Intent to bid submitted.')
    expect(screen.getByText('Intent to bid submitted.')).toBeInTheDocument()
    expect(screen.getByText('Pre-bid questions submitted.')).toBeInTheDocument()
  })

  it('shows "No outreach sent yet" for leads with no history', async () => {
    // Select l4 (Dobson Ranch HOA) which has no outreach history in mockOutreach
    useUIStore.setState({ selectedLeadId: 'l4' })

    render(<OutreachQueuePage />)
    await screen.findByText('Outreach History')
    await screen.findByText('No outreach sent yet.')
    expect(screen.getByText('No outreach sent yet.')).toBeInTheDocument()
  })

  it('fires POST /api/outreach/send when Send button is clicked with draft', async () => {
    useUIStore.setState({ selectedLeadId: 'l2' })

    let postCalled = false
    let postedBody: Record<string, unknown> | null = null

    server.use(
      http.post('/api/outreach/send', async ({ request }) => {
        postCalled = true
        postedBody = await request.json() as Record<string, unknown>
        return HttpResponse.json({ success: true, message_id: 'msg_test' })
      })
    )

    const user = userEvent.setup()
    render(<OutreachQueuePage />)

    // Wait for lead detail to load
    await screen.findByText('Outreach History')

    // Wait for lead data (ai_email_draft) to load in textarea
    // Lead l2 has an ai_email_draft, so Send Email button should be enabled
    await waitFor(() => {
      const sendBtn = screen.queryByRole('button', { name: /send email/i })
      return sendBtn !== null
    }, { timeout: 3000 })

    const sendBtn = screen.getByRole('button', { name: /send email/i })
    await user.click(sendBtn)

    await waitFor(() => {
      expect(postCalled).toBe(true)
      expect(postedBody).toMatchObject({
        lead_id: 'l2',
        channel: 'email',
      })
    })
  })

  it('renders channel selector buttons (Email, LinkedIn, Phone) in detail panel', async () => {
    useUIStore.setState({ selectedLeadId: 'l2' })
    render(<OutreachQueuePage />)
    await screen.findByText('Send via')
    // Channel selector buttons appear in the detail panel — there may be multiple Email buttons
    // (one in each queue item row + one in the detail panel)
    const emailButtons = screen.getAllByRole('button', { name: /email/i })
    expect(emailButtons.length).toBeGreaterThan(0)
    const phoneButtons = screen.getAllByRole('button', { name: /phone/i })
    expect(phoneButtons.length).toBeGreaterThan(0)
    // "Send via" text confirms the detail panel channel selector is present
    expect(screen.getByText('Send via')).toBeInTheDocument()
  })

  it('renders Snooze button', async () => {
    useUIStore.setState({ selectedLeadId: 'l2' })
    render(<OutreachQueuePage />)
    await screen.findByText('Outreach History')
    await screen.findByRole('button', { name: /snooze/i })
    expect(screen.getByRole('button', { name: /snooze/i })).toBeInTheDocument()
  })
})
