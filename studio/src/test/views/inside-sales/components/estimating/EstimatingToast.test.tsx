import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { EstimatingToastProvider } from '@/views/inside-sales/components/estimating/EstimatingToast'
import { useToast } from '@/views/inside-sales/components/estimating/useToast'

function Trigger({ message }: { message: string }) {
  const { show } = useToast()
  return (
    <button type="button" onClick={() => show(message)}>
      fire toast
    </button>
  )
}

describe('EstimatingToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the message when show() is called', () => {
    render(
      <EstimatingToastProvider>
        <Trigger message="Section duplicated" />
      </EstimatingToastProvider>,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      screen.getByRole('button', { name: /fire toast/i }).click()
    })
    expect(screen.getByRole('status')).toHaveTextContent('Section duplicated')
  })

  it('auto-dismisses after ~2.6s', () => {
    render(
      <EstimatingToastProvider>
        <Trigger message="Saved" />
      </EstimatingToastProvider>,
    )
    act(() => {
      screen.getByRole('button', { name: /fire toast/i }).click()
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    // Just before the dismiss window it is still visible…
    act(() => {
      vi.advanceTimersByTime(2500)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    // …and just after ~2.6s it is gone.
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('a second show() replaces the message and restarts the timer', () => {
    render(
      <EstimatingToastProvider>
        <Trigger message="First" />
      </EstimatingToastProvider>,
    )
    act(() => {
      screen.getByRole('button', { name: /fire toast/i }).click()
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => {
      screen.getByRole('button', { name: /fire toast/i }).click()
    })
    // 2s after the second show the toast must still be up (timer restarted)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('useToast throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Trigger message="boom" />)).toThrow(
      /EstimatingToastProvider/,
    )
    spy.mockRestore()
  })
})
