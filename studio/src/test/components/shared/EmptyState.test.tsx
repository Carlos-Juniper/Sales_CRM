import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { EmptyState } from '@/components/shared/EmptyState'

describe('EmptyState', () => {
  it('renders title prop', () => {
    render(<EmptyState title="No leads found" />)
    expect(screen.getByText('No leads found')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Try adjusting filters." />)
    expect(screen.getByText('Try adjusting filters.')).toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    render(<EmptyState title="Empty" />)
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument()
  })

  it('renders action button when action prop provided', () => {
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Retry', onClick: vi.fn() }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('calls action.onClick when button is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<EmptyState title="Empty" action={{ label: 'Retry', onClick }} />)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not render a button when no action prop', () => {
    render(<EmptyState title="Empty" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
