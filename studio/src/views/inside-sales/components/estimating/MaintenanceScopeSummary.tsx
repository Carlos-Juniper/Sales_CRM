// ---------------------------------------------------------------------------
// The maintenance editor's yearly visit counts (migration 064) plus any legacy
// free-text scope still stored on the intake. Extracted from
// MaintenanceEditor.tsx unchanged.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { estimatingApi } from '@/api/estimating'
import type { MaintenanceEstimate } from '@/types/estimating'
import { OCCURRENCE_COUNT_FIELDS } from '@/lib/estimating/occurrences'

function scopeNotesFromIntake(rows: { payload: Record<string, unknown> }[]): string | null {
  let found: string | null = null
  for (const row of rows) {
    const value = row.payload?.scopeOfWork
    if (typeof value === 'string' && value.trim() !== '') found = value
  }
  return found
}

/** Yearly visit counts plus any legacy free-text scope still stored on intake. */
export function MaintenanceScopeSummary({ estimate }: { estimate: MaintenanceEstimate }) {
  const [scopeNotes, setScopeNotes] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    estimatingApi
      .listIntake(estimate.id)
      .then((rows) => {
        if (cancelled) return
        const notes = scopeNotesFromIntake(rows)
        if (notes) setScopeNotes(notes)
      })
      .catch(() => {
        /* Intake is optional context — a miss just hides the legacy notes. */
      })
    return () => {
      cancelled = true
    }
  }, [estimate.id])

  return (
    <div
      data-testid="maintenance-occurrence-summary"
      className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
    >
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))]">
        Occurrences per year
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {OCCURRENCE_COUNT_FIELDS.map(({ key, label }) => {
          const value = estimate[key]
          return (
            <div key={key}>
              <dt className="text-[10px] text-[hsl(var(--muted-fg))]">{label}</dt>
              <dd
                data-testid={`occurrence-count-${key}`}
                className="m-0 text-sm font-medium tabular-nums text-[hsl(var(--fg))]"
              >
                {value == null ? 'Not set' : value}
              </dd>
            </div>
          )
        })}
      </dl>
      {scopeNotes && (
        <div data-testid="legacy-scope-notes" className="mt-3 border-t border-[hsl(var(--border))] pt-3">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))]">
            Scope of work
          </p>
          <p className="m-0 mt-1 whitespace-pre-wrap text-xs text-[hsl(var(--fg))]">{scopeNotes}</p>
        </div>
      )}
    </div>
  )
}
