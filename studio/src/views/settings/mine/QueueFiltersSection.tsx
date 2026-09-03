import { useLeadsStore } from '@/store/leadsStore'

export function QueueFiltersSection() {
  const filters = useLeadsStore((s) => s.filters)
  const resetFilters = useLeadsStore((s) => s.resetFilters)

  // Derive a human-readable summary of active filters so the user can see what
  // is set before deciding to reset.
  const hasActiveFilters =
    filters.search !== '' ||
    filters.minScore > 0 ||
    filters.leadTypes.length > 0 ||
    filters.states.length > 0 ||
    filters.assignedOnly ||
    filters.unassignedOnly

  return (
    <div data-testid="settings-section-queue-filters" className="space-y-4 max-w-sm">
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg)] mb-1">Queue filters</h2>
        <p className="text-xs text-[var(--fg)] opacity-60">
          These are your active lead queue filter defaults for this session.
        </p>
      </div>

      <div className="rounded-md border border-[var(--border)] p-3 space-y-1 text-xs text-[var(--fg)]">
        <p>
          <span className="font-medium">Search:</span>{' '}
          {filters.search || <span className="opacity-50">(none)</span>}
        </p>
        <p>
          <span className="font-medium">Min score:</span> {filters.minScore}
        </p>
        <p>
          <span className="font-medium">Assigned only:</span>{' '}
          {filters.assignedOnly ? 'Yes' : 'No'}
        </p>
        <p>
          <span className="font-medium">Unassigned only:</span>{' '}
          {filters.unassignedOnly ? 'Yes' : 'No'}
        </p>
      </div>

      <button
        type="button"
        onClick={resetFilters}
        disabled={!hasActiveFilters}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm
          text-[var(--fg)] hover:bg-[var(--sidebar-hover-bg)]
          disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Reset filters to defaults
      </button>
    </div>
  )
}
