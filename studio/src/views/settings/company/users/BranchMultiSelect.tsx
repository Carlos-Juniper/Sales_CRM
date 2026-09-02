import type { ManageableBranch } from '@/api/settings'

/**
 * A checkbox-list branch picker producing a replace-set of aspire_branch_ids.
 * Reused by the authorize form and each row's inline editor — the selected set
 * is the WHOLE set that gets PATCHed, matching the backend's replace-set
 * semantics (re-sending the same ids is a no-op).
 */
export function BranchMultiSelect({
  branches,
  selected,
  onToggle,
  idPrefix,
}: {
  branches: ManageableBranch[]
  selected: number[]
  onToggle: (aspireBranchId: number) => void
  /** Namespaces the testid so multiple pickers can coexist (per-row editors). */
  idPrefix: string
}) {
  if (branches.length === 0) {
    return <p className="text-xs opacity-60">No branches available.</p>
  }
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto">
      {branches.map((b) => (
        <li key={b.aspireBranchId}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid={`${idPrefix}-${b.aspireBranchId}`}
              checked={selected.includes(b.aspireBranchId)}
              onChange={() => onToggle(b.aspireBranchId)}
            />
            {b.branchName}
          </label>
        </li>
      ))}
    </ul>
  )
}
