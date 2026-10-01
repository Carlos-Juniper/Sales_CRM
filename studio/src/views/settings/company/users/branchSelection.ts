import type { ManageableBranch } from '@/api/settings'

/**
 * Pure helpers behind BranchMultiSelect. Selection is a replace-set of
 * aspire_branch_ids: every helper returns the WHOLE next set, and ids outside
 * the acted-on subset (e.g. hidden by the search filter) are left untouched.
 */

/** The header checkbox's state over the currently visible branches. */
export type HeaderState = 'all' | 'some' | 'none'

/** Case-insensitive substring match on branch name; blank query keeps all. */
export function filterBranches(
  branches: ManageableBranch[],
  query: string,
): ManageableBranch[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return branches
  return branches.filter((b) => b.branchName.toLowerCase().includes(needle))
}

export function toggleBranch(selected: number[], id: number): number[] {
  return selected.includes(id)
    ? selected.filter((s) => s !== id)
    : [...selected, id]
}

/** Adds every id in `ids`, keeping existing order and never duplicating. */
export function selectBranches(selected: number[], ids: number[]): number[] {
  const added = ids.filter((id) => !selected.includes(id))
  return added.length === 0 ? selected : [...selected, ...added]
}

/** Removes every id in `ids`; everything else stays selected. */
export function clearBranches(selected: number[], ids: number[]): number[] {
  return selected.filter((id) => !ids.includes(id))
}

export function countSelected(selected: number[], ids: number[]): number {
  return ids.filter((id) => selected.includes(id)).length
}

export function headerState(selected: number[], ids: number[]): HeaderState {
  const n = countSelected(selected, ids)
  if (n === 0) return 'none'
  return n === ids.length ? 'all' : 'some'
}
