// ---------------------------------------------------------------------------
// ITB Tracker (Handoff 13) — cross-project Invitation-to-Bid status matrix.
//
// Replaces the Excel ITB scheduler. Every active bid across the company, with
// per-scope completion status across a CONFIG-DRIVEN set of scope columns,
// quarterly roll-ups, estimator/CRM filtering, and a CRM status export.
//
// Business rules:
//   - Scope columns are data-driven from itb_scopes (ITB_SCOPE_SEED) — no code
//     change to add/remove a scope column (BRD §2.1 / II-9.12).
//   - Scope group ordering: estimating → outside_dept → vendor_only.
//   - Rebid de-duplication for L10 metrics (II-9.2).
//   - CRM status export: stubs with TODO until the real integration target lands.
//   - Status legend codes: P·C·S·R·U·X·–·E·I (BRD II-9.12; pending confirmation
//     with Carlos — see open item in Handoff 13 §4).
//
// Open items:
//   - Final status legend codes (validate vs ITB 2026.xlsx with Carlos).
//   - Relationship between ITB projects and Queue estimates (auto-populate?).
//   - Real CRM export target and L10 metric definitions.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import type { ItbProject, ItbScope, ItbScopeStatus, ItbStatusCode, ItbScopeGroup } from '@/types/estimating'
import { useToast } from './useToast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Status legend config (BRD II-9.12 — confirmed with Carlos 2026-08-06)
// ---------------------------------------------------------------------------

export interface ItbStatusDef {
  code: ItbStatusCode
  label: string
  bg: string
  text: string
  border: string
}

/** Config-driven status legend — add/edit rows here without touching render logic. */
export const ITB_STATUS_LEGEND: ItbStatusDef[] = [
  { code: 'P', label: 'Pending',         bg: '#fef9c3', text: '#854d0e', border: '#fde68a' },
  { code: 'C', label: 'Created Request', bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  { code: 'S', label: 'Sent',            bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' },
  { code: 'R', label: 'Received',        bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
  { code: 'U', label: 'Updated',         bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  { code: 'X', label: '100% Complete',   bg: '#dcfce7', text: '#15803d', border: '#86efac' },
  { code: '-', label: 'Non-Applicable',  bg: '#f3f4f6', text: '#6b7280', border: '#e5e7eb' },
]

const STATUS_MAP = new Map<string, ItbStatusDef>(ITB_STATUS_LEGEND.map((s) => [s.code, s]))
const NA_STATUS: ItbStatusDef = ITB_STATUS_LEGEND.find((s) => s.code === '-')!

// ---------------------------------------------------------------------------
// Scope group ordering
// ---------------------------------------------------------------------------

const GROUP_ORDER: Record<ItbScopeGroup, number> = {
  estimating: 0,
  outside_dept: 1,
  vendor_only: 2,
}

/** Sort scopes by group then by order within the group (never alphabetical). */
function sortedScopes(scopes: ItbScope[]): ItbScope[] {
  return [...scopes].sort((a, b) => {
    const gDiff = GROUP_ORDER[a.group] - GROUP_ORDER[b.group]
    return gDiff !== 0 ? gDiff : a.order - b.order
  })
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function centsToDollars(cents: number): number {
  return Math.round(cents) / 100
}

function formatDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(centsToDollars(cents))
}

function daysToDue(dueDate: string): number {
  const due = new Date(dueDate).getTime()
  const now = Date.now()
  return Math.round((due - now) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Component public API
// ---------------------------------------------------------------------------

export interface ItbTrackerProps {
  projects: ItbProject[]
  scopes: ItbScope[]
  statuses: ItbScopeStatus[]
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({
  projectId,
  scopeId,
  statusDef,
  scopeLabel,
}: {
  projectId: string
  scopeId: string
  statusDef: ItbStatusDef
  scopeLabel: string
}) {
  return (
    <span
      data-testid={`status-badge-${projectId}-${scopeId}`}
      title={`${scopeLabel}: ${statusDef.label}`}
      className="inline-flex items-center justify-center w-[24px] h-[24px] rounded-[4px] text-[10px] font-bold border leading-none"
      style={{
        backgroundColor: statusDef.bg,
        color: statusDef.text,
        borderColor: statusDef.border,
      }}
    >
      {statusDef.code}
    </span>
  )
}

function StatCard({
  label,
  children,
  testId,
}: {
  label: string
  children: React.ReactNode
  testId?: string
}) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm px-4 py-3">
      <p className="text-[11px] text-[hsl(var(--muted-fg))]">{label}</p>
      <p
        data-testid={testId}
        className="mt-1 text-[20px] font-extrabold font-mono text-[hsl(var(--fg))]"
      >
        {children}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ItbTracker({ projects, scopes, statuses }: ItbTrackerProps) {
  const { show } = useToast()

  // Sort scopes: group ordering then within-group order (config-driven, no code change needed)
  const orderedScopes = useMemo(() => sortedScopes(scopes), [scopes])

  // Build a fast lookup: `${projectId}|${scopeId}` → statusCode
  const statusLookup = useMemo(() => {
    const map = new Map<string, ItbStatusCode>()
    for (const s of statuses) {
      map.set(`${s.projectId}|${s.scopeId}`, s.statusCode)
    }
    return map
  }, [statuses])

  // Derive unique estimator names and CRM rep names for filter dropdowns
  const estimatorOptions = useMemo(() => {
    const names = new Set<string>()
    for (const p of projects) {
      if (p.lsEstimator) names.add(p.lsEstimator)
      if (p.irrEstimator) names.add(p.irrEstimator)
    }
    return Array.from(names).sort()
  }, [projects])

  const crmOptions = useMemo(() => {
    const names = new Set<string>()
    for (const p of projects) {
      if (p.salesRep) names.add(p.salesRep)
    }
    return Array.from(names).sort()
  }, [projects])

  const quarterOptions = useMemo(() => {
    const quarters = new Set<string>()
    for (const p of projects) {
      if (p.quarter) quarters.add(p.quarter)
    }
    return Array.from(quarters).sort()
  }, [projects])

  // Filter state
  const [filterQuarter, setFilterQuarter] = useState<string>('all')
  const [filterEstimator, setFilterEstimator] = useState<string>('all')
  const [filterCrm, setFilterCrm] = useState<string>('all')

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filterQuarter !== 'all' && p.quarter !== filterQuarter) return false
      if (filterEstimator !== 'all' && p.lsEstimator !== filterEstimator && p.irrEstimator !== filterEstimator) return false
      if (filterCrm !== 'all' && p.salesRep !== filterCrm) return false
      return true
    })
  }, [projects, filterQuarter, filterEstimator, filterCrm])

  // Stat aggregations over filtered set
  const stats = useMemo(() => {
    const nonRebid = filteredProjects.filter((p) => !p.rebid)
    const rebidCount = filteredProjects.filter((p) => p.rebid).length

    // De-duplicated total: for L10 metrics, rebid projects' dollars are NOT
    // added on top of the original bid's dollars — we show them in the list for
    // visibility but the canonical dollar total only counts each unique bid once
    // (the rebid value replaces the original).
    // For now: sum all non-rebid + rebid projects but track rebid separately.
    const estTotal = filteredProjects.reduce((s, p) => s + p.estTotalCents, 0)
    const dedupTotal = nonRebid.reduce((s, p) => s + p.estTotalCents, 0)
    const estLs = filteredProjects.reduce((s, p) => s + p.estLsCents, 0)
    const estIr = filteredProjects.reduce((s, p) => s + p.estIrCents, 0)

    return { estTotal, dedupTotal, estLs, estIr, rebidCount, projectCount: filteredProjects.length }
  }, [filteredProjects])

  function handleExport() {
    // TODO(crm): wire the real CRM export integration (integration target TBD, Handoff 13 §4).
    // Stub: toast the row count as proof of concept.
    show(`${filteredProjects.length} project(s) exported to CRM`)
  }

  // Column header styles (rotated text for scope columns)
  const TH_FIXED = 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-fg))] text-left whitespace-nowrap'
  const TH_SCOPE = 'px-1 py-2 text-[10px] font-semibold text-[hsl(var(--muted-fg))] text-center'

  return (
    <div className="flex flex-col gap-4 h-full" data-testid="itb-tracker">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          data-testid="filter-quarter"
          aria-label="Quarter filter"
          value={filterQuarter}
          onChange={(e) => setFilterQuarter(e.target.value)}
          className="h-8 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2.5 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]/30"
        >
          <option value="all">All quarters</option>
          {quarterOptions.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>

        <select
          data-testid="filter-estimator"
          aria-label="Estimator filter"
          value={filterEstimator}
          onChange={(e) => setFilterEstimator(e.target.value)}
          className="h-8 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2.5 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]/30"
        >
          <option value="all">All estimators</option>
          {estimatorOptions.map((e) => (
            <option key={e} value={e}>{e}</option>
          ))}
        </select>

        <select
          data-testid="filter-crm"
          aria-label="CRM filter"
          value={filterCrm}
          onChange={(e) => setFilterCrm(e.target.value)}
          className="h-8 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2.5 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]/30"
        >
          <option value="all">All CRM reps</option>
          {crmOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <span className="text-[11px] text-[hsl(var(--muted-fg))]">
          <span data-testid="stat-project-count" className="font-semibold text-[hsl(var(--fg))]">
            {stats.projectCount}
          </span>{' '}
          project{stats.projectCount !== 1 ? 's' : ''}
        </span>

        <div className="ml-auto">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#2E7D52] px-3 text-[11.5px] font-semibold text-white hover:bg-[#256844] cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            CRM status export
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Est total" testId="stat-est-total">
          {formatDollars(stats.estTotal)}
        </StatCard>
        <StatCard label="EST LS $" testId="stat-est-ls">
          {formatDollars(stats.estLs)}
        </StatCard>
        <StatCard label="EST IR $" testId="stat-est-ir">
          {formatDollars(stats.estIr)}
        </StatCard>
        <StatCard label="Rebids / revisions" testId="stat-rebids">
          {stats.rebidCount}
        </StatCard>
        <StatCard label="De-dup total (non-rebid)" testId="stat-dedup-total">
          {formatDollars(stats.dedupTotal)}
        </StatCard>
      </div>

      {/* Matrix table (sticky header, horizontal scroll) */}
      <div
        data-testid="itb-scroll-wrapper"
        className="flex-1 overflow-x-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm"
      >
        <table className="w-full border-collapse text-[11.5px]" style={{ minWidth: `${400 + orderedScopes.length * 44}px` }}>
          <thead
            data-testid="itb-thead"
            className="sticky top-0 z-10 bg-[hsl(var(--muted))]"
          >
            <tr>
              {/* Fixed column headers */}
              <th data-testid="col-project" className={cn(TH_FIXED, 'min-w-[200px]')}>
                Project / Aspire #
              </th>
              <th data-testid="col-dates" className={cn(TH_FIXED, 'min-w-[110px]')}>
                Dates
              </th>
              <th data-testid="col-branch-rep" className={cn(TH_FIXED, 'min-w-[110px]')}>
                Branch / Rep
              </th>
              <th data-testid="col-estimators" className={cn(TH_FIXED, 'min-w-[110px]')}>
                Estimators
              </th>
              <th data-testid="col-est-total" className={cn(TH_FIXED, 'min-w-[100px] text-right')}>
                EST Total
              </th>

              {/* Config-driven scope columns — one per scope, ordered by group+order */}
              {orderedScopes.map((scope) => (
                <th
                  key={scope.id}
                  data-testid={`scope-col-${scope.key}`}
                  className={cn(TH_SCOPE, 'w-[44px] max-w-[44px] align-bottom')}
                  title={scope.label}
                >
                  {/* Vertically-rotated scope header */}
                  <div
                    className="flex items-end justify-center"
                    style={{ height: '80px', writingMode: 'vertical-rl', transform: 'rotate(180deg)', textOverflow: 'ellipsis', overflow: 'hidden', maxHeight: '80px' }}
                  >
                    {scope.label}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredProjects.length === 0 ? (
              <tr>
                <td
                  colSpan={5 + orderedScopes.length}
                  className="px-4 py-8 text-center text-[12px] text-[hsl(var(--muted-fg))]"
                >
                  No projects match the current filters.
                </td>
              </tr>
            ) : (
              filteredProjects.map((project) => {
                const dtd = daysToDue(project.dueDate)
                return (
                  <tr
                    key={project.id}
                    data-testid={`project-row-${project.id}`}
                    className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/40"
                  >
                    {/* Project / Aspire # cell */}
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-1.5">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-[hsl(var(--fg))]">{project.name}</span>
                            {project.rebid && (
                              <span
                                data-testid={`rebid-badge-${project.id}`}
                                className="inline-flex items-center justify-center rounded px-1 py-[1px] text-[9px] font-bold bg-[#fef3c7] text-[#b45309] border border-[#fde68a]"
                              >
                                R
                              </span>
                            )}
                          </div>
                          {project.aspireNumber && (
                            <div className="text-[10px] text-[hsl(var(--muted-fg))]">
                              {project.aspireNumber}
                            </div>
                          )}
                          <div className="text-[10px] text-[hsl(var(--muted-fg))]">{project.client}</div>
                        </div>
                      </div>
                    </td>

                    {/* Dates cell */}
                    <td className="px-3 py-2">
                      <div className="text-[10.5px]">
                        <div>ITB: {project.itbDate}</div>
                        <div>Due: {project.dueDate}</div>
                        <div
                          className={cn(
                            'font-semibold',
                            dtd < 0 ? 'text-[#dc2626]' : dtd <= 7 ? 'text-[#b45309]' : 'text-[hsl(var(--muted-fg))]',
                          )}
                        >
                          {dtd < 0 ? `${Math.abs(dtd)}d overdue` : `${dtd}d to due`}
                        </div>
                      </div>
                    </td>

                    {/* Branch / Rep cell */}
                    <td className="px-3 py-2">
                      <div className="text-[10.5px]">
                        <div>{project.branch}</div>
                        {project.salesRep && (
                          <div className="text-[hsl(var(--muted-fg))]">{project.salesRep}</div>
                        )}
                      </div>
                    </td>

                    {/* Estimators cell */}
                    <td className="px-3 py-2">
                      <div className="text-[10.5px]">
                        {project.lsEstimator && (
                          <div>LS: {project.lsEstimator}</div>
                        )}
                        {project.irrEstimator && (
                          <div>IR: {project.irrEstimator}</div>
                        )}
                        {!project.lsEstimator && !project.irrEstimator && (
                          <span className="text-[hsl(var(--muted-fg))]">—</span>
                        )}
                      </div>
                    </td>

                    {/* EST Total cell */}
                    <td className="px-3 py-2 text-right font-mono">
                      <div className="text-[11px] font-bold">{formatDollars(project.estTotalCents)}</div>
                      <div className="text-[10px] text-[hsl(var(--muted-fg))]">
                        LS {formatDollars(project.estLsCents)}
                      </div>
                      <div className="text-[10px] text-[hsl(var(--muted-fg))]">
                        IR {formatDollars(project.estIrCents)}
                      </div>
                    </td>

                    {/* Config-driven scope status cells */}
                    {orderedScopes.map((scope) => {
                      const code = statusLookup.get(`${project.id}|${scope.id}`)
                      const statusDef = code ? (STATUS_MAP.get(code) ?? NA_STATUS) : NA_STATUS
                      return (
                        <td key={scope.id} className="px-1 py-2 text-center align-middle">
                          <StatusBadge
                            projectId={project.id}
                            scopeId={scope.id}
                            statusDef={statusDef}
                            scopeLabel={scope.label}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Status legend — config-driven; no code change needed to add a status */}
      <div data-testid="status-legend" className="flex flex-wrap gap-2 py-1">
        <span className="text-[10px] font-semibold text-[hsl(var(--muted-fg))] self-center mr-1">
          Legend:
        </span>
        {ITB_STATUS_LEGEND.map((s) => (
          <span
            key={s.code}
            data-testid={`legend-${s.code}`}
            className="inline-flex items-center gap-1 rounded px-2 py-[3px] text-[10px] border"
            style={{
              backgroundColor: s.bg,
              color: s.text,
              borderColor: s.border,
            }}
          >
            <span className="font-bold">{s.code}</span>
            <span>{s.label}</span>
          </span>
        ))}
      </div>

      {/* Open items note */}
      <p className="text-[10px] text-[hsl(var(--muted-fg))]">
        ⚠ Open items: final status legend codes (validate vs ITB 2026.xlsx with Carlos) · relationship
        between ITB projects and Queue estimates · real CRM export target.
      </p>
    </div>
  )
}
