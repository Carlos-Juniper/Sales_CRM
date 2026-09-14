import { useEffect, useRef, useState } from 'react'
import { useManagementCompanySearch } from '@/hooks/useManagementCompanies'

interface Props {
  value: string | null        // current management_company_id
  onSelect: (id: string | null) => void
  /** Display name for the current value — used to pre-fill the input on mount */
  displayName?: string | null
}

/**
 * Debounced search-as-you-type combobox for management companies.
 * Replaces the old 5000-row `<SelectField>` dropdown.
 *
 * - Typing triggers a backend search after 300 ms
 * - Selecting a result writes its id via onSelect and shows the name in the input
 * - "Self-managed / none" clears the selection (onSelect(null))
 * - The input is clearable via the × button
 */
export function ManagementCompanySearch({ value, onSelect, displayName }: Props) {
  // The text visible in the input
  const [inputText, setInputText] = useState<string>(displayName ?? '')
  // The debounced search term sent to the hook
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // If a value is provided with a displayName, initialise the label.
  // Syncing controlled props into local display text is a valid use of setState
  // in an effect; the alternative (useDerivedState via key) would remount the
  // entire combobox and lose focus / dropdown state.
  useEffect(() => {
    if (value && displayName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInputText(displayName)
    }
    if (!value) {
      setInputText('')
    }
  }, [value, displayName])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const { data: results, isLoading } = useManagementCompanySearch(searchTerm)

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value
    setInputText(text)
    setOpen(true)

    // Clear current selection while user types
    if (value !== null) {
      onSelect(null)
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchTerm(text)
    }, 300)
  }

  function handleSelect(id: string, name: string) {
    onSelect(id)
    setInputText(name)
    setSearchTerm('')
    setOpen(false)
  }

  function handleClear() {
    onSelect(null)
    setInputText('')
    setSearchTerm('')
    setOpen(false)
  }

  function handleSelfManaged() {
    onSelect(null)
    setInputText('')
    setSearchTerm('')
    setOpen(false)
  }

  const showDropdown = open && inputText.length >= 1
  const showResults = showDropdown && !isLoading
  const noResults = showResults && (!results || results.length === 0) && searchTerm.length >= 1

  return (
    <div ref={containerRef} className="relative">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-[hsl(var(--fg))]">Management Company</span>
        <div className="relative flex items-center">
          <input
            role="combobox"
            aria-expanded={showDropdown}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            type="text"
            value={inputText}
            onChange={handleInputChange}
            onFocus={() => { if (inputText.length >= 1) setOpen(true) }}
            placeholder="Search by company name…"
            className="h-8 w-full px-2.5 pr-7 text-sm border border-[hsl(var(--border))] rounded-md bg-[hsl(var(--card))] text-[hsl(var(--fg))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]/50"
          />
          {inputText && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear selection"
              className="absolute right-2 text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] leading-none"
            >
              ×
            </button>
          )}
        </div>
      </label>

      {showDropdown && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-md"
        >
          {/* Always-visible self-managed option */}
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            onClick={handleSelfManaged}
            className="w-full px-3 py-2 text-left text-sm text-[hsl(var(--muted-fg))] hover:bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]"
          >
            Self-managed / none
          </button>

          {/* Loading spinner */}
          {isLoading && (
            <div className="flex items-center justify-center px-3 py-2">
              <span
                role="status"
                aria-label="Loading"
                className="h-4 w-4 rounded-full border-2 border-[hsl(var(--border))] border-t-[#2E7D52] animate-spin"
              />
            </div>
          )}

          {/* Results */}
          {showResults && results && results.length > 0 && (
            <ul>
              {results.map((co) => (
                <li key={co.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === co.id}
                    onClick={() => handleSelect(co.id, co.company_name)}
                    className="w-full px-3 py-2 text-left text-sm text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
                  >
                    {co.company_name}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* No results */}
          {noResults && (
            <p className="px-3 py-2 text-sm text-[hsl(var(--muted-fg))]">No results</p>
          )}
        </div>
      )}
    </div>
  )
}
