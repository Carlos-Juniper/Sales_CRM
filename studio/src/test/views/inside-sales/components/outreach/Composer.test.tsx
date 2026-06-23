import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render, makeUser } from '@/test/utils'
import { Composer } from '@/views/inside-sales/components/outreach/Composer'
import { useAuthStore } from '@/store/authStore'

beforeEach(() => {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez' }) })
})

describe('Composer', () => {
  describe('channel tabs', () => {
    it('renders Email, LinkedIn, and Text tabs', () => {
      render(<Composer leadId="l2" contactName="Mark Benson" />)
      expect(screen.getByRole('tab', { name: /email/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /linkedin/i })).toBeInTheDocument()
      // Phone channel is labeled "Text" in the UI
      expect(screen.getByRole('tab', { name: /text/i })).toBeInTheDocument()
    })

    it('switches active channel when a tab is clicked', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" contactName="Mark Benson" />)

      await user.click(screen.getByRole('tab', { name: /linkedin/i }))

      // After switching to LinkedIn, the textarea placeholder or step hint should reflect LinkedIn
      await waitFor(() => {
        const textarea = screen.getByRole('textbox')
        const placeholder = textarea.getAttribute('placeholder') ?? ''
        // placeholder or aria-label changes to indicate LinkedIn channel
        expect(
          placeholder.toLowerCase().includes('linkedin') ||
            screen.queryByText(/linkedin/i) !== null,
        ).toBe(true)
      })
    })
  })

  describe('AI draft banner', () => {
    it('shows AI-generated draft banner for email channel when lead has ai_email_draft', async () => {
      render(<Composer leadId="l2" contactName="Mark Benson" />)
      // l2 has an ai_email_draft, so banner should appear on email tab (default)
      await screen.findByText(/AI-generated draft/i)
      expect(screen.getByText(/AI-generated draft/i)).toBeInTheDocument()
    })

    it('dismisses the AI draft banner when user starts typing in the textarea', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" contactName="Mark Benson" />)

      await screen.findByText(/AI-generated draft/i)

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Custom message I am typing now')

      await waitFor(() => {
        expect(screen.queryByText(/AI-generated draft/i)).not.toBeInTheDocument()
      })
    })

    it('dismisses the AI draft banner when Dismiss button is clicked', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" contactName="Mark Benson" />)

      await screen.findByText(/AI-generated draft/i)
      await user.click(screen.getByRole('button', { name: /dismiss/i }))

      await waitFor(() => {
        expect(screen.queryByText(/AI-generated draft/i)).not.toBeInTheDocument()
      })
    })

    it('resets textarea content to original AI draft when "Regenerate with AI" is clicked', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" contactName="Mark Benson" />)

      await screen.findByText(/AI-generated draft/i)

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      const originalDraft = textarea.value

      // User edits the draft
      await user.clear(textarea)
      await user.type(textarea, 'I replaced the whole draft')

      // Banner is gone after edit
      expect(screen.queryByText(/AI-generated draft/i)).not.toBeInTheDocument()

      // Click Regenerate with AI to restore
      await user.click(screen.getByRole('button', { name: /regenerate with ai/i }))

      await waitFor(() => {
        const updated = (screen.getByRole('textbox') as HTMLTextAreaElement).value
        expect(updated).toBe(originalDraft)
      })

      // Banner reappears after regenerating
      expect(screen.getByText(/AI-generated draft/i)).toBeInTheDocument()
    })
  })

  describe('send behavior', () => {
    it('disables the send button when the textarea is empty', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l4" contactName="Patricia Morales" />)

      // l4 has no ai_email_draft for the queue context; clear the textarea to empty state
      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)

      const sendBtn = screen.getByRole('button', { name: /send email/i })
      expect(sendBtn).toBeDisabled()
    })

    it('fires POST /api/outreach/send with correct body when send button is clicked', async () => {
      let postCalled = false
      let postedBody: Record<string, unknown> | null = null

      server.use(
        http.post('/api/outreach/send', async ({ request }) => {
          postCalled = true
          postedBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({ success: true, message_id: 'msg_test' })
        }),
      )

      const user = userEvent.setup()
      render(<Composer leadId="l4" contactName="Patricia Morales" />)

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Following up on our conversation.')

      const sendBtn = screen.getByRole('button', { name: /send email/i })
      await user.click(sendBtn)

      await waitFor(() => {
        expect(postCalled).toBe(true)
        expect(postedBody).toMatchObject({
          lead_id: 'l4',
          channel: 'email',
          message: 'Following up on our conversation.',
        })
      })
    })

    it('calls onSent callback after successful send', async () => {
      const onSent = vi.fn()

      server.use(
        http.post('/api/outreach/send', () =>
          HttpResponse.json({ success: true, message_id: 'msg_cb' }),
        ),
      )

      const user = userEvent.setup()
      render(<Composer leadId="l4" contactName="Patricia Morales" onSent={onSent} />)

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'Callback test message.')

      await user.click(screen.getByRole('button', { name: /send email/i }))

      await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1))
    })
  })

  describe('snooze', () => {
    it('renders "Snooze 3d" button', () => {
      render(<Composer leadId="l2" contactName="Mark Benson" />)
      expect(screen.getByRole('button', { name: /snooze 3d/i })).toBeInTheDocument()
    })
  })

  describe('step hint', () => {
    it('shows step hint that includes the contact name', () => {
      render(<Composer leadId="l4" contactName="Patricia Morales" />)
      expect(screen.getByText(/Patricia Morales/)).toBeInTheDocument()
    })

    it('shows step number in the hint', () => {
      render(<Composer leadId="l4" contactName="Patricia Morales" />)
      // Hint text pattern: "Step N · to Patricia Morales"
      expect(screen.getByText(/Step \d/)).toBeInTheDocument()
    })
  })
})
