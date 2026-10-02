// H54 §7 — BranchMultiSelect (a thin wrapper over the shared CheckboxList):
// search, Select all / Clear all over the filtered set, tri-state header
// checkbox, "n of m selected" chip, keyboard access. The backend treats the
// branch list as a replace-SET, so selections are compared as sets.
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ManageableBranch } from '@/api/settings'
import { BranchMultiSelect } from '@/views/settings/company/users/BranchMultiSelect'

const BRANCHES: ManageableBranch[] = [
  { aspireBranchId: 101, branchName: 'Naples', city: 'Naples' },
  { aspireBranchId: 102, branchName: 'North Naples', city: 'Naples' },
  { aspireBranchId: 202, branchName: 'Sarasota', city: 'Sarasota' },
  { aspireBranchId: 303, branchName: 'Tampa', city: 'Tampa' },
]

/** Stateful host so the picker behaves as it does inside the real forms. */
function Harness({
  initial = [],
  branches = BRANCHES,
}: {
  initial?: number[]
  branches?: ManageableBranch[]
}) {
  const [selected, setSelected] = useState<number[]>(initial)
  return (
    <>
      <BranchMultiSelect
        branches={branches}
        selected={selected}
        onChange={setSelected}
        idPrefix="bms"
      />
      <output data-testid="selected">{JSON.stringify(selected)}</output>
    </>
  )
}

const asSet = (ids: number[]) => [...ids].sort((a, b) => a - b)
/** The current selection, sorted: order is not part of the contract. */
const selectedIds = () =>
  asSet(JSON.parse(screen.getByTestId('selected').textContent ?? '[]') as number[])
const header = () => screen.getByTestId('bms-header')
const search = (value: string) =>
  fireEvent.change(screen.getByTestId('bms-search'), { target: { value } })

describe('BranchMultiSelect — search', () => {
  it('filters the list by branch name', () => {
    render(<Harness />)
    search('naples')
    expect(screen.getByTestId('bms-101')).toBeInTheDocument()
    expect(screen.getByTestId('bms-102')).toBeInTheDocument()
    expect(screen.queryByTestId('bms-202')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bms-303')).not.toBeInTheDocument()
  })

  it('shows an empty-state message when nothing matches', () => {
    render(<Harness />)
    search('miami')
    expect(screen.getByText(/no branches match/i)).toHaveTextContent('miami')
    expect(header()).toBeDisabled()
    expect(screen.getByTestId('bms-select-all')).toBeDisabled()
  })

  it('keeps the "no branches available" state when there are none', () => {
    render(<Harness branches={[]} />)
    expect(screen.getByText(/no branches available/i)).toBeInTheDocument()
    expect(screen.queryByTestId('bms-search')).not.toBeInTheDocument()
  })
})

describe('BranchMultiSelect — select all / clear all', () => {
  it('Select all with a filter active selects only the filtered branches', () => {
    render(<Harness initial={[303]} />)
    search('naples')
    fireEvent.click(screen.getByTestId('bms-select-all'))
    expect(selectedIds()).toEqual(asSet([101, 102, 303]))
  })

  it('Clear all with a filter active clears only the filtered branches', () => {
    render(<Harness initial={[101, 102, 202, 303]} />)
    search('naples')
    fireEvent.click(screen.getByTestId('bms-clear-all'))
    expect(selectedIds()).toEqual(asSet([202, 303]))
  })

  it('Select all with no filter writes every branch id explicitly', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('bms-select-all'))
    expect(selectedIds()).toEqual(asSet([101, 102, 202, 303]))
    expect(screen.getByTestId('bms-select-all')).toBeDisabled()
  })

  it('disables Clear all when nothing visible is selected', () => {
    render(<Harness initial={[303]} />)
    search('naples')
    expect(screen.getByTestId('bms-clear-all')).toBeDisabled()
  })
})

describe('BranchMultiSelect — tri-state header checkbox', () => {
  it('is unchecked, then partially checked, then checked over the filtered set', () => {
    render(<Harness />)
    search('naples')
    expect(header()).not.toBeChecked()
    expect(header()).not.toBePartiallyChecked()

    fireEvent.click(screen.getByTestId('bms-101'))
    expect(header()).not.toBeChecked()
    expect(header()).toBePartiallyChecked()

    fireEvent.click(screen.getByTestId('bms-102'))
    expect(header()).toBeChecked()
    expect(header()).not.toBePartiallyChecked()
  })

  it('selects the filtered set from none/some and clears it from all', () => {
    render(<Harness initial={[101, 303]} />)
    search('naples')
    fireEvent.click(header())
    expect(selectedIds()).toEqual(asSet([101, 102, 303]))
    expect(header()).toBeChecked()
    fireEvent.click(header())
    expect(selectedIds()).toEqual([303])
    expect(header()).not.toBeChecked()
    expect(header()).not.toBePartiallyChecked()
  })
})

describe('BranchMultiSelect — count chip', () => {
  it('shows n of m selected over all branches, ignoring the filter', () => {
    render(<Harness initial={[101, 202]} />)
    expect(screen.getByTestId('bms-count')).toHaveTextContent('2 of 4 selected')
    search('tampa')
    expect(screen.getByTestId('bms-count')).toHaveTextContent('2 of 4 selected')
  })

  it('does not count selected ids that are not in the branch list', () => {
    render(<Harness initial={[101, 999]} />)
    expect(screen.getByTestId('bms-count')).toHaveTextContent('1 of 4 selected')
  })

  it('is not a live region; only bulk actions are announced, politely', () => {
    render(<Harness />)
    expect(screen.getByTestId('bms-count')).not.toHaveAttribute('role')
    expect(screen.getByTestId('bms-count')).not.toHaveAttribute('aria-live')
    const live = screen.getByTestId('bms-announcement')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveAttribute('aria-atomic', 'true')

    fireEvent.click(screen.getByTestId('bms-101'))
    expect(live).toBeEmptyDOMElement()

    fireEvent.click(screen.getByTestId('bms-select-all'))
    expect(live).toHaveTextContent('4 of 4 selected')
    search('naples')
    fireEvent.click(screen.getByTestId('bms-clear-all'))
    expect(live).toHaveTextContent('2 of 4 selected')
  })
})

describe('BranchMultiSelect — accessibility', () => {
  it('gives every checkbox an accessible label', () => {
    render(<Harness />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(BRANCHES.length + 1)
    for (const box of boxes) expect(box).toHaveAttribute('aria-label')
    expect(screen.getByRole('checkbox', { name: 'Sarasota' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /search branches/i })).toBeInTheDocument()
  })

  it('gives the header a stable name that does not change with its state', () => {
    render(<Harness />)
    expect(header()).toHaveAccessibleName('All branches')
    fireEvent.click(header())
    expect(header()).toBeChecked()
    expect(header()).toHaveAccessibleName('All branches')

    search('naples')
    expect(header()).toHaveAccessibleName('All matching branches')
    fireEvent.click(header())
    expect(header()).not.toBeChecked()
    expect(header()).toHaveAccessibleName('All matching branches')
  })

  it('does not share a name with the Select all / Clear all buttons', () => {
    render(<Harness initial={[101]} />)
    search('naples')
    expect(header()).toHaveAccessibleName('All matching branches')
    expect(screen.getByTestId('bms-select-all')).toHaveAccessibleName('Select all matching branches')
    expect(screen.getByTestId('bms-clear-all')).toHaveAccessibleName('Clear all matching branches')
    expect(screen.queryByRole('button', { name: 'All matching branches' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /select all|clear all/i })).not.toBeInTheDocument()
  })

  it('is operable from the keyboard alone', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.tab()
    expect(screen.getByTestId('bms-search')).toHaveFocus()
    await user.keyboard('sara')
    await user.tab()
    expect(header()).toHaveFocus()
    await user.keyboard(' ')
    expect(selectedIds()).toEqual([202])
    await user.tab() // Select all is disabled now, so focus skips to Clear all
    expect(screen.getByTestId('bms-clear-all')).toHaveFocus()
    await user.tab()
    expect(screen.getByTestId('bms-202')).toHaveFocus()
    await user.keyboard(' ')
    expect(selectedIds()).toEqual([])
    await user.tab({ shift: true }) // Clear all is disabled now → Select all
    expect(screen.getByTestId('bms-select-all')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(selectedIds()).toEqual([202])
  })
})
