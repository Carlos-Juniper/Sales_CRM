// Handoff 55 §5 — the "Add item" material search combobox (MSW materials fixture).

import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from '@/test/utils'
import { server } from '@/mocks/server'
import { estimatingConfigApi } from '@/api/estimating'
import { MATERIALS_FIXTURE } from '@/mocks/materialsData'
import { MaterialSearchCombobox } from '@/views/inside-sales/components/estimating/install-editor/MaterialSearchCombobox'

afterEach(() => vi.restoreAllMocks())

function setup(codes: number[] | null = [606]) {
  const user = userEvent.setup()
  const onPick = vi.fn()
  const spy = vi.spyOn(estimatingConfigApi, 'searchMaterials')
  render(<MaterialSearchCombobox lineLabel="Line A" itemClassCodes={codes} onPick={onPick} />)
  const input = screen.getByRole('combobox', { name: 'Add item to Line A' })
  return { user, onPick, spy, input }
}

const optionNames = () =>
  within(screen.getByRole('listbox')).queryAllByRole('option').map((o) => o.textContent ?? '')

describe('MaterialSearchCombobox (H55 §5)', () => {
  it('debounces: one request for the settled term, prefiltered by the line codes', async () => {
    const { user, spy, input } = setup([606])
    await user.type(input, 'pvc')
    await waitFor(() => expect(optionNames()).toHaveLength(2))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatchObject({ q: 'pvc', itemClassCodes: [606], limit: 25, cursor: null })
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  it('"All classes" drops the prefilter and re-queries', async () => {
    const { user, spy, input } = setup([606])
    await user.type(input, 'pvc')
    await waitFor(() => expect(optionNames()).toHaveLength(2))
    await user.click(screen.getByLabelText('All classes'))
    await waitFor(() => expect(optionNames()).toHaveLength(3))
    expect(spy.mock.calls.at(-1)![0]).toMatchObject({ q: 'pvc', itemClassCodes: null })
  })

  it('hides the toggle when the line has no codes (already unfiltered)', () => {
    setup(null)
    expect(screen.queryByLabelText('All classes')).not.toBeInTheDocument()
  })

  it('shows price and unit, and "—" for a material with no current price', async () => {
    const { user, input } = setup(null)
    await user.type(input, 'valve')
    const opt = await screen.findByRole('option', { name: /1" Irrigation Valve/ })
    expect(opt).toHaveTextContent('—')
    await user.clear(input)
    await user.type(input, 'spray')
    expect(await screen.findByRole('option', { name: /Spray Head/ })).toHaveTextContent('$3.89 / EA')
  })

  it('picks a material and resets', async () => {
    const { user, input, onPick } = setup(null)
    await user.type(input, 'spray')
    await user.click(await screen.findByRole('option', { name: /Spray Head/ }))
    expect(onPick).toHaveBeenCalledWith(MATERIALS_FIXTURE.find((m) => m.inventoryId === 'IRR-SPR-4IN'))
    expect(input).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('pages with "More results" using nextCursor', async () => {
    const [a, b, c] = MATERIALS_FIXTURE
    server.use(
      http.get('*/estimating/materials', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        return HttpResponse.json(cursor === 'p2' ? { items: [c], nextCursor: null } : { items: [a, b], nextCursor: 'p2' })
      }),
    )
    const { user, input, spy } = setup(null)
    await user.type(input, 'irr')
    await waitFor(() => expect(optionNames()).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'More results' }))
    await waitFor(() => expect(optionNames()).toHaveLength(3))
    expect(spy.mock.calls.at(-1)![0]).toMatchObject({ q: 'irr', cursor: 'p2' })
    expect(screen.queryByRole('button', { name: 'More results' })).not.toBeInTheDocument()
  })

  it('shows a no-results state that points at All classes when filtered', async () => {
    const { user, input } = setup([606])
    await user.type(input, 'zzz')
    expect(await screen.findByText(/No results in this section’s classes — try All classes/)).toBeInTheDocument()
  })

  it('clear empties the search and closes the list', async () => {
    const { user, input } = setup(null)
    await user.type(input, 'pvc')
    await waitFor(() => expect(optionNames().length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: 'Clear item search for Line A' }))
    expect(input).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows an error state when the search fails', async () => {
    server.use(http.get('*/estimating/materials', () => HttpResponse.json({}, { status: 500 })))
    const { user, input } = setup(null)
    await user.type(input, 'pvc')
    expect(await screen.findByText('Materials search is unavailable.')).toBeInTheDocument()
  })
})
