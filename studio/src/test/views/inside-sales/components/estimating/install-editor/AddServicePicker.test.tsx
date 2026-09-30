// Handoff 55 §4 — the per-section "Add service" picker (MSW catalog fixture).

import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from '@/test/utils'
import { server } from '@/mocks/server'
import { AddServicePicker } from '@/views/inside-sales/components/estimating/install-editor/AddServicePicker'

async function readyPicker(name: string): Promise<HTMLSelectElement> {
  const select = screen.getByLabelText(`Add service to ${name}`) as HTMLSelectElement
  await waitFor(() => expect(select).not.toBeDisabled())
  return select
}

describe('AddServicePicker (H55 §4)', () => {
  it("lists the section category's services and inserts on pick — no Add button", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    render(
      <AddServicePicker
        section={{ id: 'sec-1', name: 'Irrigation', serviceCategoryId: 'cat-install-irrigation' }}
        onAdd={onAdd}
      />,
    )
    const select = await readyPicker('Irrigation')
    const labels = Array.from(select.options).filter((o) => o.value).map((o) => o.textContent)
    expect(labels).toEqual(['Irrigation Install (2 default items)', 'Sleeving'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    await user.selectOptions(select, 'svc-cat-irrigation-install')
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0][0]).toBe('sec-1')
    expect(onAdd.mock.calls[0][1].id).toBe('svc-cat-irrigation-install')
    expect(select.value).toBe('') // ready for the next pick
  })

  it('shows an empty state for a section whose category has no services', async () => {
    render(
      <AddServicePicker
        section={{ id: 'sec-2', name: 'Optional Services', serviceCategoryId: 'cat-install-optional' }}
        onAdd={vi.fn()}
      />,
    )
    expect(await screen.findByText('No catalog services for this section')).toBeInTheDocument()
    expect(screen.getByLabelText('Add service to Optional Services')).toBeDisabled()
  })

  it('shows an unavailable state when the catalog cannot load', async () => {
    server.use(http.get('*/estimating/service-catalog', () => HttpResponse.json({}, { status: 500 })))
    render(
      <AddServicePicker
        section={{ id: 'sec-3', name: 'Sod', serviceCategoryId: 'cat-install-sod' }}
        onAdd={vi.fn()}
      />,
    )
    expect(await screen.findByText('Service catalog unavailable')).toBeInTheDocument()
    expect(screen.getByLabelText('Add service to Sod')).toBeDisabled()
  })
})
