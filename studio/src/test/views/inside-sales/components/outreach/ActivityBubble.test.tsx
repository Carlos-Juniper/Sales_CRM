import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { ActivityBubble } from '@/views/inside-sales/components/outreach/ActivityBubble'
import type { ActivityItem } from '@/types'

// Base item factory
function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    channel: 'email',
    direction: 'out',
    body: 'Hello there.',
    performed_by: 'Chris Bauer',
    performed_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  }
}

// ── Email Card ────────────────────────────────────────────────────────────────

describe('ActivityBubble — email', () => {
  it('renders outbound email as a card (not a generic bubble)', () => {
    render(<ActivityBubble item={makeItem({ direction: 'out' })} />)
    // Card should show "You" as sender, not generic bubble-out testid
    expect(screen.getByText('You')).toBeInTheDocument()
    // "to Chris Bauer · Email" subline
    expect(screen.getByText(/to Chris Bauer.*Email/)).toBeInTheDocument()
  })

  it('renders inbound email with contact name as sender', () => {
    render(<ActivityBubble item={makeItem({ direction: 'in' })} />)
    expect(screen.getByText('Chris Bauer')).toBeInTheDocument()
    expect(screen.getByText(/to You.*Email/)).toBeInTheDocument()
  })

  it('shows subject line when subject is provided', () => {
    render(
      <ActivityBubble item={makeItem({ subject: 'Q3 Proposal Follow-up' })} />,
    )
    expect(screen.getByText('Q3 Proposal Follow-up')).toBeInTheDocument()
  })

  it('does not render subject element when subject is absent', () => {
    render(<ActivityBubble item={makeItem({ subject: undefined })} />)
    // No subject heading should be present
    expect(screen.queryByText(/Q3/)).not.toBeInTheDocument()
  })

  it('renders email body text', () => {
    render(<ActivityBubble item={makeItem({ body: 'Looking forward to your reply.' })} />)
    expect(screen.getByText('Looking forward to your reply.')).toBeInTheDocument()
  })

  it('shows "Delivered" status chip on outbound email', () => {
    render(<ActivityBubble item={makeItem({ direction: 'out' })} />)
    expect(screen.getByText('Delivered')).toBeInTheDocument()
  })

  it('does not show "Delivered" on inbound email', () => {
    render(<ActivityBubble item={makeItem({ direction: 'in' })} />)
    expect(screen.queryByText('Delivered')).not.toBeInTheDocument()
  })

  it('renders initials avatar for outbound (Y)', () => {
    // "You" is a single word → initials "Y"
    render(<ActivityBubble item={makeItem({ direction: 'out' })} />)
    expect(screen.getByText('Y')).toBeInTheDocument()
  })

  it('renders initials avatar for inbound sender', () => {
    // "Chris Bauer" → "CB"
    render(<ActivityBubble item={makeItem({ direction: 'in' })} />)
    expect(screen.getByText('CB')).toBeInTheDocument()
  })
})

// ── SMS Bubble ────────────────────────────────────────────────────────────────

describe('ActivityBubble — sms', () => {
  const smsItem = (dir: 'in' | 'out') =>
    makeItem({ channel: 'sms', direction: dir, body: 'Hey, can we reschedule?' })

  it('renders outbound SMS bubble aligned right', () => {
    const { container } = render(<ActivityBubble item={smsItem('out')} />)
    // Outer wrapper should have justify-end
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toMatch(/justify-end/)
  })

  it('renders inbound SMS bubble aligned left', () => {
    const { container } = render(<ActivityBubble item={smsItem('in')} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toMatch(/justify-start/)
  })

  it('renders SMS body text', () => {
    render(<ActivityBubble item={smsItem('out')} />)
    expect(screen.getByText('Hey, can we reschedule?')).toBeInTheDocument()
  })

  it('shows "Delivered · … · Text" tag for outbound SMS', () => {
    render(<ActivityBubble item={smsItem('out')} />)
    expect(screen.getByText(/Delivered.*Text/)).toBeInTheDocument()
  })

  it('shows "{name} · … · Text" tag for inbound SMS', () => {
    render(<ActivityBubble item={smsItem('in')} />)
    expect(screen.getByText(/Chris Bauer.*Text/)).toBeInTheDocument()
  })

  it('outbound SMS bubble has green background class', () => {
    const { container } = render(<ActivityBubble item={smsItem('out')} />)
    const bubble = container.querySelector('.bg-\\[\\#2E7D52\\]')
    expect(bubble).not.toBeNull()
  })
})

// ── Call Bubble ───────────────────────────────────────────────────────────────

describe('ActivityBubble — call', () => {
  const callItem = (overrides: Partial<ActivityItem> = {}) =>
    makeItem({ channel: 'call', direction: 'out', body: 'Discussed proposal.', ...overrides })

  it('renders call bubble with data-testid="bubble-out" for outbound', () => {
    render(<ActivityBubble item={callItem()} />)
    expect(screen.getByTestId('bubble-out')).toBeInTheDocument()
  })

  it('renders call bubble with data-testid="bubble-in" for inbound', () => {
    render(<ActivityBubble item={callItem({ direction: 'in' })} />)
    expect(screen.getByTestId('bubble-in')).toBeInTheDocument()
  })

  it('renders call duration chip when duration_seconds is set', () => {
    render(<ActivityBubble item={callItem({ duration_seconds: 183 })} />)
    expect(screen.getByTestId('call-duration')).toHaveTextContent('3:03')
  })

  it('does not render duration chip when duration_seconds is null', () => {
    render(<ActivityBubble item={callItem({ duration_seconds: null })} />)
    expect(screen.queryByTestId('call-duration')).not.toBeInTheDocument()
  })

  it('renders audio player when recording_url is present', () => {
    render(
      <ActivityBubble item={callItem({ recording_url: 'https://cdn.example.com/rec.mp3' })} />,
    )
    const audio = document.querySelector('audio')
    expect(audio).not.toBeNull()
    expect(audio?.getAttribute('src')).toBe('https://cdn.example.com/rec.mp3')
  })

  it('does not render audio player when recording_url is absent', () => {
    render(<ActivityBubble item={callItem({ recording_url: null })} />)
    expect(document.querySelector('audio')).toBeNull()
  })

  it('renders call body text', () => {
    render(<ActivityBubble item={callItem()} />)
    expect(screen.getByText('Discussed proposal.')).toBeInTheDocument()
  })
})

// ── Note / Meeting Bubble ─────────────────────────────────────────────────────

describe('ActivityBubble — note', () => {
  it('renders note with data-testid="bubble-out"', () => {
    render(
      <ActivityBubble
        item={makeItem({ channel: 'note', direction: 'out', body: 'Left voicemail.' })}
      />,
    )
    expect(screen.getByTestId('bubble-out')).toBeInTheDocument()
    expect(screen.getByText('Left voicemail.')).toBeInTheDocument()
  })

  it('renders note with data-testid="bubble-in"', () => {
    render(
      <ActivityBubble
        item={makeItem({ channel: 'note', direction: 'in', body: 'Client replied.' })}
      />,
    )
    expect(screen.getByTestId('bubble-in')).toBeInTheDocument()
  })
})

describe('ActivityBubble — meeting', () => {
  it('renders meeting with generic bubble', () => {
    render(
      <ActivityBubble
        item={makeItem({ channel: 'meeting', direction: 'out', body: 'Site visit scheduled.' })}
      />,
    )
    expect(screen.getByTestId('bubble-out')).toBeInTheDocument()
    expect(screen.getByText('Site visit scheduled.')).toBeInTheDocument()
  })
})

// ── LinkedIn removed ──────────────────────────────────────────────────────────

describe('ActivityBubble — LinkedIn removed', () => {
  it('does not render a LinkedIn-specific label', () => {
    // Even if a linkedin item leaks through, there should be no "LinkedIn" label text
    // (The component has no linkedin branch — it falls through to generic bubble
    //  which uses CHANNEL_LABELS that no longer contains linkedin)
    render(
      <ActivityBubble
        item={makeItem({ channel: 'note', direction: 'out', body: 'No linkedin here.' })}
      />,
    )
    expect(screen.queryByText('LinkedIn')).not.toBeInTheDocument()
  })
})
