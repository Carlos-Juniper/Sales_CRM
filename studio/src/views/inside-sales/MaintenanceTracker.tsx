// ---------------------------------------------------------------------------
// Maintenance Estimating Tracker (§8) — cross-property progress board.
//
// Fetches all maintenance estimates and renders a scrollable table with
// editable cells for the manager to track per-estimate progress:
//   - trackingStatus — ENUM chip updated on blur (PATCH /api/estimating/estimates/{id})
//   - trackerComment — free-text note updated on blur
//   - dueBackDate, winProbability, anticipatedCloseDate, serviceStartDate
//     are also inline-editable via the same PATCH path
//
// Days Till Due is computed client-side and color-coded.
// A CSV export button exports the current rows.
//
// Visual polish deferred — this is the functional stub.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { estimatingApi } from '@/api/estimating'
import type { Estimate } from '@/types/estimating'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Tracker status config — chip colors per value
// ---------------------------------------------------------------------------

const TRACKING_STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  not_started:  { label: 'Not Started',   bg: '#f3f4f6', text: '#6b7280' },
  in_progress:  { label: 'In Progress',   bg: '#dbeafe', text: '#1e40af' },
  drafted:      { label: 'Drafted',       bg: '#e0e7ff', text: '#3730a3' },
  ai_scanning:  { label: 'AI Scanning',   bg: '#fef3c7', text: '#92400e' },
  takeoff_comp: { label: 'Takeoff Comp.', bg: '#d1fae5', text: '#065f46' },
  on_hold:      { label: 'On Hold',       bg: '#fce7f3', text: '#9d174d' },
  passed:       { label: 'Passed',        bg: '#fee2e2', text: '#991b1b' },
  delivered:    { label: 'Delivered',     bg: '#dcfce7', text: '#15803d' },
  completed:    { label: 'Completed',     bg: '#d1fae5', text: '#065f46' },
}

const TRACKING_STATUS_OPTIONS = Object.keys(TRACKING_STATUS_MAP)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Days between a date string and today; negative = overdue. */
function daysTillDue(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null
  const due = new Date(dueDate).getTime()
  const now = Date.now()
  return Math.round((due - now) / 86_400_000)
}

function dtdClass(days: number | null): string {
  if (days === null) return ''
  if (days <= 0) return 'text-red-600 font-semibold'
  if (days <= 6) return 'text-amber-600 font-semibold'
  if (days > 20) return 'text-green-700 font-semibold'
  return ''
}

/** Quote a CSV field (RFC 4180). */
function csvField(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function csvRow(values: string[]): string {
  return values.map(csvField).join(',')
}

function pct(v: number | null): string {
  if (v == null) return ''
  return `${Math.round(v * 100)}%`
}

// ---------------------------------------------------------------------------
// Per-cell editable input
// ---------------------------------------------------------------------------

function EditableCell({
  value,
  estimateId,
  field,
  type = 'text',
  onSaved,
  format,
  parse,
}: {
  value: string | null | undefined
  estimateId: string
  field: string
  type?: 'text' | 'date' | 'number' | 'select'
  onSaved?: () => void
  /** Transform stored value → display string (default: identity). */
  format?: (v: string) => string
  /** Transform typed string → value to PATCH (default: identity, or null on empty). */
  parse?: (s: string) => unknown
}) {
  const displayValue = format ? (value != null && value !== '' ? format(value) : '') : (value ?? '')
  const [localVal, setLocalVal] = useState(displayValue)
  const queryClient = useQueryClient()

  const { mutate } = useMutation({
    mutationFn: (next: unknown) =>
      estimatingApi.update(estimateId, { [field]: next ?? null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-tracker'] })
      onSaved?.()
    },
  })

  const handleBlur = useCallback(() => {
    if (parse) {
      const parsed = localVal === '' ? null : parse(localVal)
      mutate(parsed)
    } else {
      const next = localVal === '' ? null : localVal
      mutate(next)
    }
  }, [localVal, mutate, parse])

  if (type === 'select') {
    return (
      <select
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={handleBlur}
        className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-1.5 py-[2px] text-[11px] text-[hsl(var(--fg))] focus:outline-none"
      >
        <option value="">—</option>
        {TRACKING_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {TRACKING_STATUS_MAP[s].label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={type}
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={handleBlur}
      className="w-full rounded border border-transparent bg-transparent px-1 py-[2px] text-[11px] text-[hsl(var(--fg))] hover:border-[hsl(var(--border))] focus:border-[hsl(var(--border))] focus:outline-none"
    />
  )
}

// ---------------------------------------------------------------------------
// Tracking status chip (display only — row has its own EditableCell)
// ---------------------------------------------------------------------------

function StatusChip({ value }: { value: string | null }) {
  if (!value) return <span className="text-[hsl(var(--muted-fg))]">—</span>
  const def = TRACKING_STATUS_MAP[value]
  if (!def) return <span className="text-[11px]">{value}</span>
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-[2px] text-[10px] font-semibold"
      style={{ backgroundColor: def.bg, color: def.text }}
    >
      {def.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MaintenanceTracker() {
  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ['maintenance-tracker'],
    queryFn: () => estimatingApi.list({ estimateType: 'maintenance' }),
  })

  // CSV export
  const handleExport = useCallback(() => {
    const header = csvRow([
      'Property Name', 'Property Address', 'Salesperson', 'Branch',
      'Due Date', 'Days Till Due', 'Status', 'Estimator',
      'Close %', 'Close Date', 'Start Date', 'Comments',
    ])
    const rows = estimates.map((e) => {
      const dtd = daysTillDue(e.dueBackDate)
      return csvRow([
        e.name,
        '', // property address not on estimate shape — reserved column
        e.crmRep ?? '',
        e.branchCity ?? '',
        e.dueBackDate ?? '',
        dtd != null ? String(dtd) : '',
        e.trackingStatus ?? '',
        [e.assignedLsEstimator, e.assignedIrrEstimator].filter(Boolean).join(' / '),
        pct(e.winProbability),
        e.anticipatedCloseDate ?? '',
        e.serviceStartDate ?? '',
        e.trackerComment ?? '',
      ])
    })
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `maintenance-tracker-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [estimates])

  const TH = 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] text-left whitespace-nowrap'

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40 text-[12px] text-[hsl(var(--muted-fg))]">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 h-full" data-testid="maintenance-tracker">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-[hsl(var(--muted-fg))]">
          <span className="font-semibold text-[hsl(var(--fg))]">{estimates.length}</span>
          {' '}estimate{estimates.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#2E7D52] px-3 text-[11.5px] font-semibold text-white hover:bg-[#256844] cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div
        data-testid="tracker-scroll-wrapper"
        className="flex-1 overflow-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm"
      >
        <table className="w-full border-collapse text-[11.5px]" style={{ minWidth: '1100px' }}>
          <thead
            data-testid="tracker-thead"
            className="sticky top-0 z-10 bg-[hsl(var(--muted))]"
          >
            <tr>
              <th className={cn(TH, 'min-w-[180px]')}>Property Name</th>
              <th className={cn(TH, 'min-w-[160px]')}>Property Address</th>
              <th className={cn(TH, 'min-w-[120px]')}>Salesperson</th>
              <th className={cn(TH, 'min-w-[100px]')}>Branch</th>
              <th className={cn(TH, 'min-w-[110px]')}>Due Date</th>
              <th className={cn(TH, 'min-w-[90px]')}>Days Till Due</th>
              <th className={cn(TH, 'min-w-[140px]')}>Status</th>
              <th className={cn(TH, 'min-w-[120px]')}>Estimator</th>
              <th className={cn(TH, 'min-w-[80px]')}>Close %</th>
              <th className={cn(TH, 'min-w-[110px]')}>Close Date</th>
              <th className={cn(TH, 'min-w-[110px]')}>Start Date</th>
              <th className={cn(TH, 'min-w-[200px]')}>Comments</th>
            </tr>
          </thead>
          <tbody>
            {estimates.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-4 py-8 text-center text-[12px] text-[hsl(var(--muted-fg))]"
                >
                  No maintenance estimates found.
                </td>
              </tr>
            ) : (
              estimates.map((e) => {
                const dtd = daysTillDue(e.dueBackDate)
                const estimator = [e.assignedLsEstimator, e.assignedIrrEstimator]
                  .filter(Boolean)
                  .join(' / ')
                return (
                  <tr
                    key={e.id}
                    data-testid={`tracker-row-${e.id}`}
                    className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40"
                  >
                    {/* Property Name */}
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-[hsl(var(--fg))]">{e.name}</span>
                    </td>

                    {/* Property Address — not on estimate shape; reserved */}
                    <td className="px-3 py-1.5 text-[hsl(var(--muted-fg))]">
                      {e.branchCity ?? '—'}
                    </td>

                    {/* Salesperson */}
                    <td className="px-3 py-1.5 text-[hsl(var(--muted-fg))]">
                      {e.crmRep ?? '—'}
                    </td>

                    {/* Branch */}
                    <td className="px-3 py-1.5 text-[hsl(var(--muted-fg))]">
                      {e.branchCity ?? '—'}
                    </td>

                    {/* Due Date — editable */}
                    <td className="px-2 py-1">
                      <EditableCell
                        value={e.dueBackDate ?? ''}
                        estimateId={e.id}
                        field="dueBackDate"
                        type="date"
                      />
                    </td>

                    {/* Days Till Due — computed + color */}
                    <td className={cn('px-3 py-1.5 font-mono', dtdClass(dtd))}>
                      {dtd != null ? dtd : '—'}
                    </td>

                    {/* Status — editable select + chip */}
                    <td className="px-2 py-1">
                      <EditableCell
                        value={e.trackingStatus ?? ''}
                        estimateId={e.id}
                        field="trackingStatus"
                        type="select"
                      />
                    </td>

                    {/* Estimator */}
                    <td className="px-3 py-1.5 text-[hsl(var(--muted-fg))]">
                      {estimator || '—'}
                    </td>

                    {/* Close % — editable; stored as 0–1 fraction, displayed as 0–100 */}
                    <td className="px-2 py-1">
                      <EditableCell
                        value={e.winProbability != null ? String(e.winProbability) : ''}
                        estimateId={e.id}
                        field="winProbability"
                        type="number"
                        format={(v) => String(Math.round(Number(v) * 100))}
                        parse={(s) => Number(s) / 100}
                      />
                    </td>

                    {/* Close Date — editable */}
                    <td className="px-2 py-1">
                      <EditableCell
                        value={e.anticipatedCloseDate ?? ''}
                        estimateId={e.id}
                        field="anticipatedCloseDate"
                        type="date"
                      />
                    </td>

                    {/* Start Date — editable */}
                    <td className="px-2 py-1">
                      <EditableCell
                        value={e.serviceStartDate ?? ''}
                        estimateId={e.id}
                        field="serviceStartDate"
                        type="date"
                      />
                    </td>

                    {/* Comments — editable */}
                    <td className="px-2 py-1">
                      <EditableCell
                        value={e.trackerComment ?? ''}
                        estimateId={e.id}
                        field="trackerComment"
                        type="text"
                      />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
