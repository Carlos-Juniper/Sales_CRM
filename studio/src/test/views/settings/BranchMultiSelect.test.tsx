// H54 §7 — BranchMultiSelect: search, Select all / Clear all over the filtered
// set, tri-state header checkbox, "n of m selected" chip, keyboard access.
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

const selectedIds = () =>
  JSON.parse(screen.getByTestId('selected').textContent ?? '[]') as number[]
const header = () => screen.getByTestId('bms-header') as HTMLInputElement
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
    expect(selectedIds()).toEqual([303, 101, 102])
  })

  it('Clear all with a filter active clears only the filtered branches', () => {
    render(<Harness initial={[101, 102, 202, 303]} />)
    search('naples')
    fireEvent.click(screen.getByTestId('bms-clear-all'))
    expect(selectedIds()).toEqual([202, 303])
  })

  it('Select all with no filter writes every branch id explicitly', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('bms-select-all'))
    expect(selectedIds()).toEqual([101, 102, 202, 303])
    expect(screen.getByTestId('bms-select-all')).toBeDisabled()
  })

  it('disables Clear all when nothing visible is selected', () => {
    render(<Harness initial={[303]} />)
    search('naples')
    expect(screen.getByTestId('bms-clear-all')).toBeDisabled()
  })
})

describe('BranchMultiSelect — tri-state header checkbox', () => {
  it('is unchecked, then indeterminate, then checked over the filtered set', () => {
    render(<Harness />)
    search('naples')
    expect(header().checked).toBe(false)
    expect(header().indeterminate).toBe(false)

    fireEvent.click(screen.getByTestId('bms-101'))
    expect(header().checked).toBe(false)
    expect(header().indeterminate).toBe(true)

    fireEvent.click(screen.getByTestId('bms-102'))
    expect(header().checked).toBe(true)
    expect(header().indeterminate).toBe(false)
  })

  it('selects the filtered set from none/some and clears it from all', () => {
    render(<Harness initial={[101, 303]} />)
    search('naples')
    fireEvent.click(header())
    expect(selectedIds()).toEqual([101, 303, 102])
    fireEvent.click(header())
    expect(selectedIds()).toEqual([303])
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

  it('names the bulk controls after the filtered scope', () => {
    render(<Harness />)
    search('naples')
    expect(header()).toHaveAccessibleName('Select all matching branches')
    expect(screen.getByRole('button', { name: 'Select all matching branches' })).toBeInTheDocument()
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
