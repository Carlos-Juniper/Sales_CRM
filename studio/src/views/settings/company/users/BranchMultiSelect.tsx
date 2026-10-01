import { useState } from 'react'
import type { ManageableBranch } from '@/api/settings'
import {
  clearBranches,
  countSelected,
  filterBranches,
  headerState,
  selectBranches,
  toggleBranch,
} from './branchSelection'
import { TriStateCheckbox } from './TriStateCheckbox'

const linkButton =
  'rounded-md border border-[var(--border)] px-2 py-0.5 text-xs disabled:opacity-50'

/**
 * A searchable checkbox-list branch picker producing a replace-set of
 * aspire_branch_ids. Reused by the authorize form and each row's inline editor
 * — `selected` is the WHOLE set that gets PATCHed, matching the backend's
 * replace-set semantics. Select all / Clear all and the tri-state header act on
 * the FILTERED branches only, and always write explicit ids (no "all" sentinel).
 */
export function BranchMultiSelect({
  branches,
  selected,
  onChange,
  idPrefix,
}: {
  branches: ManageableBranch[]
  selected: number[]
  onChange: (next: number[]) => void
  /** Namespaces the testids so multiple pickers can coexist (per-row editors). */
  idPrefix: string
}) {
  const [query, setQuery] = useState('')

  if (branches.length === 0) {
    return <p className="text-xs opacity-60">No branches available.</p>
  }

  const visible = filterBranches(branches, query)
  const visibleIds = visible.map((b) => b.aspireBranchId)
  const state = headerState(selected, visibleIds)
  const filtered = query.trim() !== ''
  const scope = filtered ? 'matching branches' : 'branches'

  const selectAll = () => onChange(selectBranches(selected, visibleIds))
  const clearAll = () => onChange(clearBranches(selected, visibleIds))

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search branches…"
        aria-label="Search branches"
        data-testid={`${idPrefix}-search`}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <TriStateCheckbox
          state={state}
          onChange={state === 'all' ? clearAll : selectAll}
          label={`${state === 'all' ? 'Clear' : 'Select'} all ${scope}`}
          testId={`${idPrefix}-header`}
          disabled={visible.length === 0}
        />
        <button
          type="button"
          onClick={selectAll}
          disabled={state === 'all' || visible.length === 0}
          aria-label={`Select all ${scope}`}
          data-testid={`${idPrefix}-select-all`}
          className={linkButton}
        >
          Select all
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={state === 'none'}
          aria-label={`Clear all ${scope}`}
          data-testid={`${idPrefix}-clear-all`}
          className={linkButton}
        >
          Clear all
        </button>
        <span
          role="status"
          data-testid={`${idPrefix}-count`}
          className="ml-auto rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium"
        >
          {countSelected(selected, branches.map((b) => b.aspireBranchId))} of{' '}
          {branches.length} selected
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs opacity-60">No branches match “{query.trim()}”.</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {visible.map((b) => (
            <li key={b.aspireBranchId}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={b.branchName}
                  data-testid={`${idPrefix}-${b.aspireBranchId}`}
                  checked={selected.includes(b.aspireBranchId)}
                  onChange={() => onChange(toggleBranch(selected, b.aspireBranchId))}
                />
                {b.branchName}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
