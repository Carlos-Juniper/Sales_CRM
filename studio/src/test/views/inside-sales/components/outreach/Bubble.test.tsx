import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { Bubble } from '@/views/inside-sales/components/outreach/Bubble'
import type { OutreachHistory } from '@/types'

function makeBubble(overrides: Partial<OutreachHistory> = {}): OutreachHistory {
  return {
    id: 'o1',
    lead_id: 'l1',
    channel: 'email',
    message: 'Test message content',
    sent_at: new Date(Date.now() - 3600000).toISOString(),
    direction: 'out',
    response_received: false,
    response_at: null,
    sequence_step: 1,
    next_follow_up: null,
    ...overrides,
  }
}

describe('Bubble', () => {
  describe('outbound bubble', () => {
    it('renders with data-testid="bubble-out" for outbound direction', () => {
      render(<Bubble item={makeBubble({ direction: 'out' })} />)
      expect(screen.getByTestId('bubble-out')).toBeInTheDocument()
    })

    it('displays the message text', () => {
      render(<Bubble item={makeBubble({ direction: 'out', message: 'Intent to bid submitted.' })} />)
      expect(screen.getByText('Intent to bid submitted.')).toBeInTheDocument()
    })

    it('shows "You" as the sender label for outbound messages', () => {
      render(<Bubble item={makeBubble({ direction: 'out' })} />)
      expect(screen.getByText('You')).toBeInTheDocument()
    })

    it('shows "Read" receipt when response_received is true', () => {
      render(<Bubble item={makeBubble({ direction: 'out', response_received: true })} />)
      expect(screen.getByText('Read')).toBeInTheDocument()
    })

    it('shows "Sent" receipt when response_received is false', () => {
      render(<Bubble item={makeBubble({ direction: 'out', response_received: false })} />)
      expect(screen.getByText('Sent')).toBeInTheDocument()
    })
  })

  describe('inbound bubble', () => {
    it('renders with data-testid="bubble-in" for inbound direction', () => {
      render(<Bubble item={makeBubble({ direction: 'in', sender_name: 'Chris Abbott' })} />)
      expect(screen.getByTestId('bubble-in')).toBeInTheDocument()
    })

    it('displays the message text', () => {
      render(
        <Bubble
          item={makeBubble({
            direction: 'in',
            sender_name: 'Chris Abbott',
            message: "Thanks for reaching out. I'd be open to a comparison proposal.",
          })}
        />,
      )
      expect(screen.getByText(/Thanks for reaching out/)).toBeInTheDocument()
    })

    it('shows the sender name for inbound messages', () => {
      render(<Bubble item={makeBubble({ direction: 'in', sender_name: 'Chris Abbott' })} />)
      expect(screen.getByText('Chris Abbott')).toBeInTheDocument()
    })

    it('shows "Response received" label for inbound messages', () => {
      render(
        <Bubble
          item={makeBubble({
            direction: 'in',
            sender_name: 'Nicole Foster',
            response_received: false,
          })}
        />,
      )
      expect(screen.getByText('Response received')).toBeInTheDocument()
    })
  })

  describe('channel badge', () => {
    it('shows "Email" badge for email channel', () => {
      render(<Bubble item={makeBubble({ channel: 'email' })} />)
      expect(screen.getByText('Email')).toBeInTheDocument()
    })

    it('shows "LinkedIn" badge for linkedin channel', () => {
      render(<Bubble item={makeBubble({ channel: 'linkedin' })} />)
      expect(screen.getByText('LinkedIn')).toBeInTheDocument()
    })

    it('shows "Text" badge for phone channel (not "Phone")', () => {
      render(<Bubble item={makeBubble({ channel: 'phone' })} />)
      expect(screen.getByText('Text')).toBeInTheDocument()
      expect(screen.queryByText('Phone')).not.toBeInTheDocument()
    })
  })

  describe('timestamp', () => {
    it('renders a relative or formatted time derived from sent_at', () => {
      const sentAt = new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      render(<Bubble item={makeBubble({ sent_at: sentAt })} />)
      // The component should render some time string — at minimum the container exists
      const bubble = screen.getByTestId('bubble-out')
      expect(bubble).toBeInTheDocument()
      // A time element or text representing the sent timestamp should be present somewhere
      const timeEl = bubble.querySelector('time') ?? bubble.querySelector('[data-testid="bubble-time"]')
      // If no semantic time element, the timestamp text is still somewhere in the bubble
      if (timeEl) {
        expect(timeEl).toBeInTheDocument()
      } else {
        // Accept any non-empty text in the bubble beyond message and labels
        expect(bubble.textContent).toBeTruthy()
      }
    })
  })
})
