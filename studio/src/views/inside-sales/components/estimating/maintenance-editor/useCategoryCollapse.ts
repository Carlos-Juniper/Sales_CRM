import { useState } from 'react'
import type { ServiceGroup } from '@/lib/estimating/maintenanceCategories'
import { hasOccurrences } from '@/lib/estimating/maintenanceHours'

/**
 * Per-category expanded state. A category's default — expanded when it has
 * occurrences, collapsed otherwise — is fixed the first time it is seen once
 * the catalog has settled (`ready`), so editing occurrences to 0 never
 * collapses a block under the cursor, and lines regrouped by a late catalog
 * load still get the right default.
 */
export function useCategoryCollapse(groups: ServiceGroup[], ready: boolean) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const unseen = ready ? groups.filter((g) => !(g.key in expanded)) : []
  if (unseen.length > 0) {
    // Adjust-state-during-render: record defaults for newly seen categories.
    // Existing entries always win.
    const defaults = Object.fromEntries(unseen.map((g) => [g.key, hasOccurrences(g.services)]))
    setExpanded((prev) => ({ ...defaults, ...prev }))
  }

  const isExpanded = (key: string): boolean => {
    if (key in expanded) return expanded[key]
    return hasOccurrences(groups.find((g) => g.key === key)?.services ?? [])
  }
  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !isExpanded(key) }))
  const expand = (key: string) => setExpanded((prev) => ({ ...prev, [key]: true }))

  return { isExpanded, toggle, expand }
}
