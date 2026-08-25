// ---------------------------------------------------------------------------
// ITB Tracker data (frontend fetch layer).
//
// GET /api/estimating/itb/projects returns one AUTO-GENERATED project per
// active estimate (status not won/lost, branch-scoped server-side), each
// embedding its scope statuses. This hook flattens that payload into the two
// arrays ItbTracker takes as props (`projects` + `statuses`). Unlike the
// session-cached config sets (useEstimatingConfig), ITB data is live — every
// mount refetches, and `refresh()` refetches after a mutation.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { estimatingItbApi, type ItbProjectWithStatuses } from '@/api/estimating'
import type { ItbProject, ItbScopeStatus } from '@/types/estimating'

export interface ItbProjectsData {
  projects: ItbProject[]
  /** Flattened scope statuses (one row per project × scope) for ItbTracker. */
  statuses: ItbScopeStatus[]
  /** True once the fetch responded (empty list included). */
  loaded: boolean
  /** Refetch (e.g. after a scope-status PATCH). */
  refresh: () => Promise<void>
}

export function useItbProjects(): ItbProjectsData {
  const [projects, setProjects] = useState<ItbProject[]>([])
  const [statuses, setStatuses] = useState<ItbScopeStatus[]>([])
  const [loaded, setLoaded] = useState(false)

  const apply = useCallback((rows: ItbProjectWithStatuses[]) => {
    // ItbProjectWithStatuses extends ItbProject, so rows pass straight through
    // as projects; the embedded statuses flatten into the tracker's prop shape.
    setProjects(rows)
    setStatuses(rows.flatMap((row) => row.statuses))
    setLoaded(true)
  }, [])

  const refresh = useCallback(async () => {
    try {
      apply(await estimatingItbApi.projects())
    } catch {
      // Leave the previous (or empty) data; the tracker renders an empty state.
      setLoaded(true)
    }
  }, [apply])

  useEffect(() => {
    let alive = true
    estimatingItbApi
      .projects()
      .then((rows) => {
        if (alive) apply(rows)
      })
      .catch(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [apply])

  return { projects, statuses, loaded, refresh }
}
