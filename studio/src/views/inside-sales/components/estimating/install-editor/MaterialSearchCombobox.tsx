// ---------------------------------------------------------------------------
// Handoff 55 §5 — "Add item" material search on a service row.
//
// Same pattern as accounts/ManagementCompanySearch.tsx: 300 ms debounce,
// role="combobox" + aria-expanded / haspopup / autocomplete, click-outside
// close, clear button, loading and no-results states. Adds the section's
// soft item-class prefilter with a visible "All classes" toggle, and keyset
// paging ("More results") over the capped API pages.
// ---------------------------------------------------------------------------

import { useEffect, useId, useRef, useState } from 'react'
import type { MaterialSearchItem } from '@/types/estimating'
import { useDebouncedValue, useMaterialSearch } from '@/hooks/useMaterialSearch'
import { effectiveItemClassCodes } from '@/lib/estimating/materialSearch'
import { centsOrDash } from './grid'

export function MaterialSearchCombobox({
  lineLabel,
  itemClassCodes,
  onPick,
}: {
  /** The service line's label, for accessible names. */
  lineLabel: string
  /** The line's item classes (soft prefilter, from its service's category); null = unfiltered. */
  itemClassCodes: number[] | null
  onPick: (material: MaterialSearchItem) => void
}) {
  const [inputText, setInputText] = useState('')
  const [open, setOpen] = useState(false)
  const [allClasses, setAllClasses] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const term = useDebouncedValue(inputText)
  const codes = effectiveItemClassCodes(itemClassCodes, allClasses)
  const { data, isFetching, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useMaterialSearch(term, codes)
  const results = data?.pages.flatMap((p) => p.items) ?? []

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  function reset() {
    setInputText('')
    setOpen(false)
  }

  function pick(m: MaterialSearchItem) {
    onPick(m)
    reset()
  }

  const settled = term.trim() === inputText.trim()
  const showDropdown = open && inputText.trim().length >= 1
  const loading = showDropdown && (!settled || (isFetching && !isFetchingNextPage))
  const noResults = showDropdown && !loading && !isError && results.length === 0

  return (
    <div ref={containerRef} className="relative flex items-center gap-2">
      <div className="relative flex items-center">
        <input
          role="combobox"
          aria-label={`Add item to ${lineLabel}`}
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={listId}
          type="text"
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value)
            setOpen(true)
          }}
          onFocus={() => inputText && setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          placeholder="+ Add item: search materials…"
          className="h-7 w-64 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 pr-6 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]/50"
        />
        {inputText && (
          <button
            type="button"
            onClick={reset}
            aria-label={`Clear item search for ${lineLabel}`}
            className="absolute right-1.5 text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] leading-none"
          >
            ×
          </button>
        )}
      </div>
      {itemClassCodes && (
        <label className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-fg))] cursor-pointer">
          <input
            type="checkbox"
            checked={allClasses}
            onChange={(e) => setAllClasses(e.target.checked)}
          />
          All classes
        </label>
      )}

      {showDropdown && (
        <div
          id={listId}
          role="listbox"
          aria-label={`Materials for ${lineLabel}`}
          className="absolute left-0 top-8 z-50 w-[28rem] max-h-72 overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-md"
        >
          {loading && (
            <div className="flex items-center justify-center px-3 py-2">
              <span
                role="status"
                aria-label="Loading"
                className="h-4 w-4 rounded-full border-2 border-[hsl(var(--border))] border-t-[#2E7D52] animate-spin"
              />
            </div>
          )}
          {isError && <p className="px-3 py-2 text-xs text-red-700">Materials search is unavailable.</p>}
          {!loading &&
            results.map((m) => (
              <button
                key={m.inventoryId}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(m)}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-[11px] hover:bg-[hsl(var(--muted))]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[hsl(var(--fg))]">{m.description}</span>
                  <span className="block truncate text-[10px] text-[hsl(var(--muted-fg))]">
                    {m.inventoryId}
                    {m.itemClassLabel ? ` · ${m.itemClassLabel}` : ''}
                  </span>
                </span>
                <span className="flex-shrink-0 tabular-nums text-[hsl(var(--muted-fg))]">
                  {centsOrDash(m.unitCostCents)}
                  {m.costUom ?? m.uom ? ` / ${m.costUom ?? m.uom}` : ''}
                </span>
              </button>
            ))}
          {!loading && hasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full border-t border-[hsl(var(--border))] px-3 py-1.5 text-center text-[11px] font-medium text-[#2E7D52] hover:underline"
            >
              {isFetchingNextPage ? 'Loading…' : 'More results'}
            </button>
          )}
          {noResults && (
            <p className="px-3 py-2 text-xs text-[hsl(var(--muted-fg))]">
              No results{codes ? ' in this section’s classes — try All classes' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
