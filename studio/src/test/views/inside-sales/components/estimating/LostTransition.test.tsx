import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from '@/test/utils'
import { server } from '@/mocks/server'
import { LostTransition } from '@/views/inside-sales/components/estimating/LostTransition'

const API = '/api'

describe('LostTransition', () => {
  it('reveals the reason dropdown when marking lost', async () => {
    const user = userEvent.setup()
    render(<LostTransition estimateId="est-1" status="handed_back" />)
    await user.click(screen.getByRole('button', { name: /mark as lost/i }))
    expect(screen.getByLabelText(/lost reason/i)).toBeInTheDocument()
  })

  it('requires a reason before confirming', async () => {
    const user = userEvent.setup()
    render(<LostTransition estimateId="est-1" status="handed_back" />)
    await user.click(screen.getByRole('button', { name: /mark as lost/i }))
    expect(screen.getByRole('button', { name: /confirm lost/i })).toBeDisabled()
  })

  it('sends status=lost with the reason id and notifies', async () => {
    const user = userEvent.setup()
    let body: any
    server.use(
      http.patch(`${API}/estimating/estimates/est-1`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 'est-1', status: 'lost' })
      }),
    )
    const onLost = vi.fn()
    render(<LostTransition estimateId="est-1" status="handed_back" onLost={onLost} />)
    await user.click(screen.getByRole('button', { name: /mark as lost/i }))
    await user.selectOptions(screen.getByLabelText(/lost reason/i), 'Price')
    await user.click(screen.getByRole('button', { name: /confirm lost/i }))
    await waitFor(() => expect(body).toEqual({ status: 'lost', lostReasonId: 13 }))
    await waitFor(() => expect(onLost).toHaveBeenCalled())
  })

  it('does not render for an already-terminal estimate', () => {
    const { container } = render(<LostTransition estimateId="est-1" status="won" />)
    expect(container).toBeEmptyDOMElement()
  })
})
