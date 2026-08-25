import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from '@/test/utils'
import { server } from '@/mocks/server'
import { SyncStatusBadge } from '@/views/inside-sales/components/estimating/SyncStatusBadge'

const API = '/api'

function ref(over: Partial<{ id: string; aspireNumber: string | null; aspireSyncStatus: 'pending' | 'synced' | 'failed' }> = {}) {
  return { id: 'est-1', aspireNumber: null, aspireSyncStatus: 'pending' as const, ...over }
}

describe('SyncStatusBadge', () => {
  it('shows the Aspire number and no retry when synced', () => {
    render(<SyncStatusBadge estimate={ref({ aspireNumber: '408123', aspireSyncStatus: 'synced' })} />)
    expect(screen.getByText('408123')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('offers a retry when failed', () => {
    render(<SyncStatusBadge estimate={ref({ aspireSyncStatus: 'failed' })} />)
    expect(screen.getByText(/sync failed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('offers a retry while pending', () => {
    render(<SyncStatusBadge estimate={ref({ aspireSyncStatus: 'pending' })} />)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls the retry endpoint and notifies on success', async () => {
    const user = userEvent.setup()
    let called = false
    server.use(
      http.post(`${API}/estimating/estimates/est-1/retry-aspire-sync`, () => {
        called = true
        return HttpResponse.json({ status: 'queued' }, { status: 202 })
      }),
    )
    const onRetried = vi.fn()
    render(<SyncStatusBadge estimate={ref({ aspireSyncStatus: 'failed' })} onRetried={onRetried} />)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(called).toBe(true))
    await waitFor(() => expect(onRetried).toHaveBeenCalled())
  })

  it('surfaces an inline error when retry fails and does not notify', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`${API}/estimating/estimates/est-1/retry-aspire-sync`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    )
    const onRetried = vi.fn()
    render(<SyncStatusBadge estimate={ref({ aspireSyncStatus: 'failed' })} onRetried={onRetried} />)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/retry failed/i)
    expect(onRetried).not.toHaveBeenCalled()
  })
})
