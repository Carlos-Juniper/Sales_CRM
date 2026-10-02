import type { CheckState } from '@/components/ui/tri-state-checkbox'

/**
 * Generic multi-select helpers over a list of ids treated as a set. Every
 * helper returns the WHOLE next selection (replace-set semantics), and ids
 * outside the acted-on subset (e.g. hidden by a search filter) are left
 * untouched. Callers holding a Set can round-trip through an array.
 */

/** Adds `id` if missing, removes it if present. */
export function toggleId<Id>(selected: readonly Id[], id: Id): Id[] {
  return selected.includes(id)
    ? selected.filter((s) => s !== id)
    : [...selected, id]
}

/** Adds every id in `ids`, never duplicating. */
export function selectIds<Id>(selected: readonly Id[], ids: readonly Id[]): Id[] {
  return [...selected, ...ids.filter((id) => !selected.includes(id))]
}

/** Removes every id in `ids`; everything else stays selected. */
export function clearIds<Id>(selected: readonly Id[], ids: readonly Id[]): Id[] {
  return selected.filter((id) => !ids.includes(id))
}

/** How many of `ids` are selected (selections outside `ids` are ignored). */
export function countSelected<Id>(selected: readonly Id[], ids: readonly Id[]): number {
  return ids.filter((id) => selected.includes(id)).length
}

/** Whether all, some, or none of `ids` are selected; none for empty `ids`. */
export function checkState<Id>(selected: readonly Id[], ids: readonly Id[]): CheckState {
  const n = countSelected(selected, ids)
  if (n === 0) return 'none'
  return n === ids.length ? 'all' : 'some'
}

/** Case-insensitive substring match on `getText`; a blank query keeps all. */
export function filterByText<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...items]
  return items.filter((item) => getText(item).toLowerCase().includes(needle))
}
