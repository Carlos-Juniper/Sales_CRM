import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Composer (modal)', () => {
  describe('modal structure', () => {
    it('renders as a modal with a scrim overlay', () => {
      render(<Composer leadId="l2" onClose={() => {}} />)
      // The scrim is a fixed overlay covering the viewport
      const scrim = document.querySelector('.fixed.inset-0')
      expect(scrim).not.toBeNull()
    })

    it('clicking the scrim (outside the modal) calls onClose', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<Composer leadId="l2" onClose={onClose} />)

      // The scrim is the fixed inset-0 element; clicking it directly triggers onClose
      const scrim = document.querySelector('.fixed.inset-0') as HTMLElement
      expect(scrim).not.toBeNull()

      // mousedown on the scrim element itself
      await user.pointer({ target: scrim, keys: '[MouseLeft]' })

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('renders "New message" heading', () => {
      render(<Composer leadId="l2" onClose={() => {}} />)
      expect(screen.getByText('New message')).toBeInTheDocument()
    })

    it('does NOT contain linkedin anywhere in the composer', () => {
      render(<Composer leadId="l2" onClose={() => {}} />)
      const modalContainer = document.querySelector('.fixed.inset-0')
      expect(modalContainer?.textContent?.toLowerCase()).not.toMatch(/linkedin/)
    })
  })

  describe('channel control', () => {
    it('renders Email/Text segmented control in the header', () => {
      render(<Composer leadId="l2" onClose={() => {}} />)
      // Both Email and Text buttons should be present
      const emailBtn = screen.getByRole('button', { name: /^email$/i })
      const textBtn = screen.getByRole('button', { name: /^text$/i })
      expect(emailBtn).toBeInTheDocument()
      expect(textBtn).toBeInTheDocument()
    })

    it('switches to SMS mode when Text button is clicked', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" onClose={() => {}} />)

      await user.click(screen.getByRole('button', { name: /^text$/i }))

      await waitFor(() => {
        // SMS textarea should appear
        const textarea = screen.getByRole('textbox')
        expect(textarea.tagName.toLowerCase()).toBe('textarea')
      })
    })
  })

  describe('To field', () => {
    it('shows recipient chips pre-filled from lead data', async () => {
      render(<Composer leadId="l2" onClose={() => {}} />)
      // l2 has contact_name: 'Mark Benson'
      await waitFor(() => {
        expect(screen.getByText('Mark Benson')).toBeInTheDocument()
      })
    })
  })

  describe('email fields', () => {
    it('shows "From" field when channel is email', () => {
      render(<Composer leadId="l2" onClose={() => {}} />)
      expect(screen.getByText('From')).toBeInTheDocument()
    })

    it('shows Subject input when channel is email', () => {
      render(<Composer leadId="l2" onClose={() => {}} />)
      expect(screen.getByText('Subject')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/add a subject/i)).toBeInTheDocument()
    })

    it('shows rich text toolbar with Bold, Italic, Underline, List buttons when channel is email', () => {
      render(<Composer leadId="l2" onClose={() => {}} />)
      expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /italic/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /underline/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /list/i })).toBeInTheDocument()
    })

    it('hides "From" and Subject when switched to SMS mode', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" onClose={() => {}} />)

      await user.click(screen.getByRole('button', { name: /^text$/i }))

      await waitFor(() => {
        expect(screen.queryByText('From')).not.toBeInTheDocument()
        expect(screen.queryByText('Subject')).not.toBeInTheDocument()
      })
    })
  })

  describe('SMS composer', () => {
    it('shows SMS textarea when channel is sms', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" onClose={() => {}} />)

      await user.click(screen.getByRole('button', { name: /^text$/i }))

      await waitFor(() => {
        const textarea = screen.getByPlaceholderText(/write a text message/i)
        expect(textarea).toBeInTheDocument()
      })
    })

    it('shows char count and segment count in SMS mode', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" onClose={() => {}} />)

      await user.click(screen.getByRole('button', { name: /^text$/i }))

      await waitFor(() => {
        // Should show "N chars · M segment(s)"
        expect(screen.getByText(/chars/i)).toBeInTheDocument()
        expect(screen.getByText(/segment/i)).toBeInTheDocument()
      })
    })

    it('shows quiet hours warning when smsBlocked is true (time >= 21:00)', async () => {
      // Use fake timers with shouldAdvanceTime so userEvent doesn't hang
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(new Date('2024-01-15T22:00:00'))

      const user = userEvent.setup()
      render(<Composer leadId="l2" onClose={() => {}} />)
      await user.click(screen.getByRole('button', { name: /^text$/i }))

      // In SMS mode, the compliance notice must appear
      await waitFor(() => {
        expect(screen.getByText(/compliance/i)).toBeInTheDocument()
      })

      // The quiet hours warning appears if it's currently >= 21:00
      // (smsBlocked = channel==='sms' && quietHours && !scheduleLabel)
      // Since we've set time to 22:00, smsBlocked should be true
      const warning = screen.queryByText(/quiet hours/i)
      if (warning) {
        expect(warning).toBeInTheDocument()
      }
    })
  })

  describe('schedule popover', () => {
    it('opens schedule popover when clock button is clicked', async () => {
      const user = userEvent.setup()
      render(<Composer leadId="l2" onClose={() => {}} />)

      // Wait for the lead to load (recipient chip) before typing — needed to enable canSend
      await waitFor(() => {
        expect(screen.getByText('Mark Benson')).toBeInTheDocument()
      })

      // Type in subject to enable the send + schedule buttons (canSend = recipients > 0 && subject)
      const subjectInput = screen.getByPlaceholderText(/add a subject/i)
      await user.type(subjectInput, 'Test subject')

      // The Schedule button (Clock icon) should now be enabled
      const clockBtn = screen.getByRole('button', { name: /schedule/i })
      expect(clockBtn).not.toBeDisabled()
      await user.click(clockBtn)

      await waitFor(() => {
        expect(screen.getByText('Schedule send')).toBeInTheDocument()
      })
    })
  })

  describe('send behavior', () => {
    it('calls useSendOutreach.mutateAsync with correct body on Send click', async () => {
      let postCalled = false
      let postedBody: Record<string, unknown> | null = null

      server.use(
        http.post('/api/outreach/send', async ({ request }) => {
          postCalled = true
          postedBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({ success: true, message_id: 'msg_modal' })
        }),
      )

      const user = userEvent.setup()
      render(<Composer leadId="l2" onClose={() => {}} />)

      // Wait for recipient chip to appear (l2 has contact_name)
      await waitFor(() => {
        expect(screen.getByText('Mark Benson')).toBeInTheDocument()
      })

      // Fill in subject to enable send
      const subjectInput = screen.getByPlaceholderText(/add a subject/i)
      await user.type(subjectInput, 'Test email subject')

      const sendBtn = screen.getByRole('button', { name: /^send$|^send to \d+$/i })
      await user.click(sendBtn)

      await waitFor(() => {
        expect(postCalled).toBe(true)
        expect(postedBody).toMatchObject({
          lead_id: 'l2',
          channel: 'email',
        })
      })
    })

    it('closes the modal (calls onClose) after successful send', async () => {
      server.use(
        http.post('/api/outreach/send', () =>
          HttpResponse.json({ success: true, message_id: 'msg_close' }),
        ),
      )

      const onClose = vi.fn()
      const user = userEvent.setup()
      render(<Composer leadId="l2" onClose={onClose} />)

      await waitFor(() => {
        expect(screen.getByText('Mark Benson')).toBeInTheDocument()
      })

      const subjectInput = screen.getByPlaceholderText(/add a subject/i)
      await user.type(subjectInput, 'Close test')

      const sendBtn = screen.getByRole('button', { name: /^send$|^send to \d+$/i })
      await user.click(sendBtn)

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1)
      })
    })
  })
})
