import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { TriStateCheckbox } from '@/components/ui/tri-state-checkbox'
import {
  checkState,
  clearIds,
  countSelected,
  filterByText,
  selectIds,
  toggleId,
} from '@/lib/selection'

export interface CheckboxListProps<T, Id extends string | number> {
  items: T[]
  /** The WHOLE selection; `onChange` receives the whole next selection. */
  selected: Id[]
  onChange: (next: Id[]) => void
  getId: (item: T) => Id
  /** Visible label, accessible name, and search text for an item. */
  getLabel: (item: T) => string
  /** Plural noun for labels and empty states, e.g. "branches". */
  noun: string
  /** Namespaces the testids so multiple lists can coexist. */
  idPrefix: string
}

/**
 * A searchable checkbox list with Select all / Clear all and a tri-state
 * header. Bulk controls act on the FILTERED items only and always write
 * explicit ids; selections hidden by the filter are kept.
 */
export function CheckboxList<T, Id extends string | number>({
  items,
  selected,
  onChange,
  getId,
  getLabel,
  noun,
  idPrefix,
}: CheckboxListProps<T, Id>) {
  const [query, setQuery] = useState('')
  // Only bulk actions are announced: a single checkbox already announces its
  // own state, so a live count chip would be noisy on every click.
  const [announcement, setAnnouncement] = useState('')

  if (items.length === 0) {
    return <p className="text-xs opacity-60">No {noun} available.</p>
  }

  const allIds = items.map(getId)
  const visible = filterByText(items, query, getLabel)
  const visibleIds = visible.map(getId)
  const state = checkState(selected, visibleIds)
  const scope = query.trim() !== '' ? `matching ${noun}` : noun
  const countText = (ids: Id[]) =>
    `${countSelected(ids, allIds)} of ${items.length} selected`

  const bulkChange = (next: Id[]) => {
    onChange(next)
    setAnnouncement(countText(next))
  }
  const selectAll = () => bulkChange(selectIds(selected, visibleIds))
  const clearAll = () => bulkChange(clearIds(selected, visibleIds))

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${noun}…`}
        aria-label={`Search ${noun}`}
        data-testid={`${idPrefix}-search`}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <TriStateCheckbox
          state={state}
          onChange={state === 'all' ? clearAll : selectAll}
          aria-label={`All ${scope}`}
          data-testid={`${idPrefix}-header`}
          disabled={visible.length === 0}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={selectAll}
          disabled={state === 'all' || visible.length === 0}
          aria-label={`Select all ${scope}`}
          data-testid={`${idPrefix}-select-all`}
        >
          Select all
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearAll}
          disabled={state === 'none'}
          aria-label={`Clear all ${scope}`}
          data-testid={`${idPrefix}-clear-all`}
        >
          Clear all
        </Button>
        <span
          data-testid={`${idPrefix}-count`}
          className="ml-auto rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium"
        >
          {countText(selected)}
        </span>
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid={`${idPrefix}-announcement`}
          className="sr-only"
        >
          {announcement}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs opacity-60">
          No {noun} match “{query.trim()}”.
        </p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {visible.map((item) => {
            const id = getId(item)
            const label = getLabel(item)
            return (
              <li key={id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={label}
                    data-testid={`${idPrefix}-${id}`}
                    checked={selected.includes(id)}
                    onChange={() => onChange(toggleId(selected, id))}
                  />
                  {label}
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
