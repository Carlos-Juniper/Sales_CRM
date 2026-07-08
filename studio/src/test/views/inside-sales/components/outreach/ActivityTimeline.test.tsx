import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { ConversationPane } from '@/views/inside-sales/components/outreach/ConversationPane'

beforeEach(() => {
  useAuthStore.setState({ user: makeUser() })
})

describe('ActivityTimeline — unified activity feed', () => {
  it('renders email activity items', async () => {
    render(<ConversationPane leadId="l2" />)
    await screen.findByText('Intent to bid submitted.')
    expect(screen.getByText('Pre-bid questions submitted.')).toBeInTheDocument()
  })

  it('renders call activity with duration badge', async () => {
    render(<ConversationPane leadId="l3" />)
    // l3 has a call with duration_seconds: 183
    await waitFor(() => {
      // Should show duration somewhere — "3:03" or "183s" or similar
      expect(
        screen.queryByText(/3:03|183s|3 min/i) ?? screen.queryByTestId('call-duration')
      ).not.toBeNull()
    })
  })

  it('renders sms activity items', async () => {
    render(<ConversationPane leadId="l3" />)
    await screen.findByText('Following up re: our call today.')
  })

  it('shows an audio player for calls with recording_url', async () => {
    render(<ConversationPane leadId="l3" />)
    await waitFor(() => {
      const audio = document.querySelector('audio')
      expect(audio).not.toBeNull()
    })
  })

  it('shows transcript summary for calls', async () => {
    render(<ConversationPane leadId="l3" />)
    // Transcript summary is shown inline below the call bubble
    await screen.findByText(/Contact interested in Q3 start/i)
  })

  it('shows empty state when no activity', async () => {
    render(<ConversationPane leadId="l4" />)
    await screen.findByText('Dobson Ranch HOA')
    await screen.findByText(/start the conversation|no messages yet/i)
  })

  it('filters by channel when tab clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(<ConversationPane leadId="l3" />)
    await screen.findByText('Hi Chris, reaching out about Juniper Landscaping.')

    // Click the "Call" tab to filter to call channel only
    await user.click(screen.getByRole('tab', { name: /^call$/i }))
    await waitFor(() => {
      // Call activity body should be visible after filtering to phone/call channel
      expect(screen.getByText('Call logged: discussed proposal timeline.')).toBeInTheDocument()
      expect(screen.queryByText('Hi Chris, reaching out about Juniper Landscaping.')).not.toBeInTheDocument()
    })
  })
})
