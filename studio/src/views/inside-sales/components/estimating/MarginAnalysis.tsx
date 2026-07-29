// ---------------------------------------------------------------------------
// MarginAnalysis (Handoff 07) — manager-facing profitability gut-check for
// the OPEN estimate, before approval. Not a pricing rule.
//
//   • KPIs + service-group panel derive from the single live estimate model
//     (useEstimatingShell().openEstimate) — the same object the editors
//     mutate. No second data tree (the prototype's unsynced copy is gone).
//   • The service panel is a PIVOT: re-aggregated BY SERVICE across all
//     sections, cost-basis (lib/estimating/margins.ts).
//   • Branches by estimateType: maintenance = hours-driven cost basis;
//     install = materials-inclusive graphic (BRD II-9.7).
//   • Margin colors come from config DEFAULT_MARGIN_BANDS; benchmark bands
//     are provisional config rows (BRD III-6 auto-calculator is future).
// ---------------------------------------------------------------------------

import type { CSSProperties } from 'react'
import './MarginAnalysis.css'
import {
  BarChart2,
  CheckCircle2,
  Info,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Estimate, MarginBandLabel } from '@/types/estimating'
import { contractTotal, groupMargin, marginBand } from '@/lib/estimating/calc'
import { DEFAULT_MARGIN_BANDS } from '@/lib/estimating/config'
import { formatCents } from '@/lib/estimating/maintenance'
import {
  MARGIN_BENCHMARKS,
  type BenchmarkStatus,
  type ServiceGroupMargin,
  barWidthPct,
  benchmarkStatus,
  estimateAcres,
  medianCents,
  mowingPerOccurrenceCents,
  perAcreCents,
  serviceGroupMargins,
} from '@/lib/estimating/margins'
import { useEstimatingShell } from './useEstimatingShell'
import { cn } from '@/lib/utils'

// ----- Band + palette metadata (display only; thresholds live in config) -----

const BAND_META: Record<MarginBandLabel, { text: string; color: string; Icon: typeof CheckCircle2 }> = {
  good: { text: 'text-green-700 dark:text-green-400', color: '#2E7D52', Icon: CheckCircle2 },
  ok: { text: 'text-amber-600 dark:text-amber-400', color: '#d97706', Icon: TriangleAlert },
  low: { text: 'text-red-600 dark:text-red-400', color: '#dc2626', Icon: TriangleAlert },
}

/** Group dot palette, assigned by group order (display-only). */
const GROUP_COLORS = ['#2E7D52', '#2563eb', '#7c3aed', '#0891b2', '#d97706', '#dc2626', '#0d9488']

const STATUS_META: Record<
  BenchmarkStatus,
  { verdict: string; chip: string; badge: string }
> = {
  ok: { verdict: 'In range', chip: 'in range', badge: 'bg-green-50 text-green-700 border-green-200' },
  low: { verdict: 'Below typical', chip: 'below band', badge: 'bg-red-50 text-red-700 border-red-200' },
  high: { verdict: 'Above typical', chip: 'above band', badge: 'bg-orange-50 text-orange-700 border-orange-200' },
}

function fmtK(cents: number): string {
  return `$${(cents / 100_000).toFixed(1)}K`
}

// ----- Service-group rows ------------------------------------------------------

function GroupHeader({ group, color }: { group: ServiceGroupMargin; color: string }) {
  const band = marginBand(group.marginPct, DEFAULT_MARGIN_BANDS)
  const meta = BAND_META[band]
  const Icon = meta.Icon
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 min-w-0">
        <span className="h-3 w-3 rounded-sm flex-shrink-0 margin-category-dot" style={{ '--dot-color': color } as CSSProperties} />
        <span className="text-sm font-medium text-[hsl(var(--fg))] truncate">{group.label}</span>
        <span className="text-xs text-[hsl(var(--muted-fg))] whitespace-nowrap">
          {Math.round(group.shareOfContract * 100)}% of contract
        </span>
      </div>
      <div className="flex items-center gap-1.5" data-testid="group-margin-value" data-band={band}>
        <Icon className={cn('h-4 w-4', meta.text)} />
        <span className={cn('text-sm font-bold', meta.text)}>{(group.marginPct * 100).toFixed(1)}%</span>
      </div>
    </div>
  )
}

/** Maintenance group row — hours-driven cost basis with the margin/40 bar. */
function MaintenanceGroupRow({ group, color }: { group: ServiceGroupMargin; color: string }) {
  return (
    <div className="space-y-1.5" data-testid="margin-group-row">
      <GroupHeader group={group} color={color} />
      <div className="h-4 bg-[hsl(var(--muted))] rounded-full overflow-hidden" data-testid="group-margin-bar">
        <div
          className="h-full rounded-full transition-all duration-500 margin-bar-fill"
          style={{ '--bar-width': `${barWidthPct(group.marginPct)}%`, '--bar-color': color } as CSSProperties}
        />
      </div>
      <div className="flex justify-between text-[10px] text-[hsl(var(--muted-fg))]">
        <span>Cost: {formatCents(group.costCents)}</span>
        <span>{group.hoursPerYear.toFixed(1)} h/yr</span>
        <span>Price: {formatCents(group.priceCents)}</span>
      </div>
    </div>
  )
}

/** Install group row — materials-inclusive cost-split graphic (BRD II-9.7). */
function InstallGroupRow({ group, color }: { group: ServiceGroupMargin; color: string }) {
  const cost = group.costCents || 1
  const matPct = (group.materialCostCents / cost) * 100
  const laborPct = (group.laborCostCents / cost) * 100
  const otherPct = (group.unattributedCostCents / cost) * 100
  return (
    <div className="space-y-1.5" data-testid="margin-group-row">
      <GroupHeader group={group} color={color} />
      {/* Stacked cost split: materials (dominant driver) · labor · unattributed */}
      <div className="flex h-4 rounded-full overflow-hidden bg-[hsl(var(--muted))]" data-testid="group-cost-split-bar">
        <div className="h-full margin-split-seg" style={{ '--seg-width': `${matPct}%`, '--seg-color': color } as CSSProperties} />
        <div className="h-full margin-split-seg opacity-45" style={{ '--seg-width': `${laborPct}%`, '--seg-color': color } as CSSProperties} />
        <div className="h-full margin-split-seg" style={{ '--seg-width': `${otherPct}%`, '--seg-color': '#9ca3af' } as CSSProperties} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-[10px] text-[hsl(var(--muted-fg))]">
        <span>
          Materials: {formatCents(group.materialCostCents)}{' '}
          <span className="font-medium">({Math.round(matPct)}% of cost)</span>
        </span>
        <span>Labor: {formatCents(group.laborCostCents)}</span>
        <span>Price: {formatCents(group.priceCents)}</span>
      </div>
    </div>
  )
}

// ----- Benchmark cards -----------------------------------------------------------

interface BenchCard {
  testId: string
  label: string
  value: string
  bandLabel: string
  note: string
  status: BenchmarkStatus
}

function buildBenchCards(estimate: Estimate): { verdict: BenchmarkStatus; perAcre: number; cards: BenchCard[] } {
  const perAcre = perAcreCents(estimate)
  const contract = contractTotal(estimate)
  const mowingOcc = mowingPerOccurrenceCents(estimate)
  const cards: BenchCard[] = [
    {
      testId: 'bench-card-per-acre',
      label: '$ / acre — this bid',
      value: `${formatCents(Math.round(perAcre))}/ac`,
      bandLabel: MARGIN_BENCHMARKS.perAcre.bandLabel,
      note: MARGIN_BENCHMARKS.perAcre.note,
      status: benchmarkStatus(perAcre, MARGIN_BENCHMARKS.perAcre),
    },
    {
      testId: 'bench-card-annual',
      label: 'Annual $ — comparable size',
      value: formatCents(contract),
      bandLabel: MARGIN_BENCHMARKS.annualValue.bandLabel,
      note: MARGIN_BENCHMARKS.annualValue.note,
      status: benchmarkStatus(contract, MARGIN_BENCHMARKS.annualValue),
    },
  ]
  if (mowingOcc !== null) {
    cards.push({
      testId: 'bench-card-mowing',
      label: 'Mowing $ / occurrence',
      value: formatCents(Math.round(mowingOcc)),
      bandLabel: MARGIN_BENCHMARKS.mowingPerOccurrence.bandLabel,
      note: MARGIN_BENCHMARKS.mowingPerOccurrence.note,
      status: benchmarkStatus(mowingOcc, MARGIN_BENCHMARKS.mowingPerOccurrence),
    })
  }
  // The headline verdict keys off the $/acre band — the manager's first read.
  return { verdict: cards[0].status, perAcre, cards }
}

const VERDICT_SUB: Record<BenchmarkStatus, (perAcre: string, band: string) => string> = {
  ok: (v, band) => `${v}/ac sits within the typical ${band} band for comparable won bids.`,
  low: (v) => `${v}/ac is under the typical band — check for missed scope or under-pricing.`,
  high: (v) => `${v}/ac is above the typical band — confirm scope justifies the premium.`,
}

// ----- Main component ---------------------------------------------------------------

export function MarginAnalysis() {
  const { openEstimate } = useEstimatingShell()

  if (!openEstimate) {
    return (
      <div
        data-testid="margin-empty"
        className="flex flex-col items-center gap-2 py-16 text-center text-[hsl(var(--muted-fg))]"
      >
        <BarChart2 className="h-8 w-8" />
        <p className="text-sm font-medium text-[hsl(var(--fg))]">No estimate open</p>
        <p className="text-xs max-w-sm">
          Open an estimate from the queue to review its margins — a gut-check before approval, not
          a pricing rule.
        </p>
      </div>
    )
  }

  const estimate = openEstimate
  const isMaintenance = estimate.estimateType === 'maintenance'
  const groups = serviceGroupMargins(estimate)
  const contract = contractTotal(estimate)
  const totalCost = groups.reduce((s, g) => s + g.costCents, 0)
  const overall = groupMargin(contract, totalCost)
  const overallBand = marginBand(overall, DEFAULT_MARGIN_BANDS)
  const overallMeta = BAND_META[overallBand]
  const deltaPts = (overall - estimate.targetMargin) * 100
  const aboveTarget = deltaPts >= 0

  const bench = buildBenchCards(estimate)
  const verdictMeta = STATUS_META[bench.verdict]
  const treeSorted = [...MARGIN_BENCHMARKS.treeWorkSaleCents].sort((a, b) => a - b)
  const treeMedian = medianCents(MARGIN_BENCHMARKS.treeWorkSaleCents)

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* Context header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[hsl(var(--fg))]">{estimate.name}</h2>
          <p className="text-xs text-[hsl(var(--muted-fg))]">
            Margin analysis · {estimateAcres(estimate).toFixed(1)} ac ·{' '}
            {isMaintenance ? 'maintenance (hours-driven)' : 'install (materials-driven)'}
          </p>
        </div>
        <span className="text-[11px] text-[hsl(var(--muted-fg))] inline-flex items-center gap-1">
          <Info className="h-3.5 w-3.5" />
          A gut-check before approval, not a pricing rule
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-3 pb-3" data-testid="margin-kpi-contract">
            <p className="text-xs text-[hsl(var(--muted-fg))]">Total contract value</p>
            <p className="text-lg font-bold text-[hsl(var(--fg))]">{formatCents(contract)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3" data-testid="margin-kpi-cost">
            <p className="text-xs text-[hsl(var(--muted-fg))]">Total cost</p>
            <p className="text-lg font-bold text-[hsl(var(--fg))]">{formatCents(totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3" data-testid="margin-kpi-margin" data-band={overallBand}>
            <p className="text-xs text-[hsl(var(--muted-fg))]">Overall gross margin</p>
            <p className={cn('text-lg font-bold', overallMeta.text)}>{(overall * 100).toFixed(1)}%</p>
            <p className="text-[10px] text-[hsl(var(--muted-fg))] flex items-center gap-0.5">
              {aboveTarget ? (
                <TrendingUp className="h-3 w-3 text-green-600" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              {aboveTarget ? '+' : ''}
              {deltaPts.toFixed(1)}% vs target
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3" data-testid="margin-kpi-target">
            <p className="text-xs text-[hsl(var(--muted-fg))]">Target margin</p>
            <p className="text-lg font-bold text-[hsl(var(--fg))]">
              {(estimate.targetMargin * 100).toFixed(0)}%
            </p>
            <p className="text-[10px] text-[hsl(var(--muted-fg))]">branch standard</p>
          </CardContent>
        </Card>
      </div>

      {/* Margin by service group — branched by estimateType */}
      <Card data-testid={isMaintenance ? 'margin-groups-maintenance' : 'margin-groups-install'}>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Margin by service group</CardTitle>
          <p className="text-xs text-[hsl(var(--muted-fg))]">
            {isMaintenance
              ? 'Maintenance cost-basis view — hours-driven groups aggregated across every section, not an install-style Labor/Materials/Equipment stack.'
              : 'Install materials-inclusive view — install pricing is materials-driven, so each group shows its materials/labor cost split (BRD II-9.7).'}
          </p>
        </CardHeader>
        <CardContent className="pb-4 space-y-5">
          {groups.map((g, i) =>
            isMaintenance ? (
              <MaintenanceGroupRow key={g.label} group={g} color={GROUP_COLORS[i % GROUP_COLORS.length]} />
            ) : (
              <InstallGroupRow key={g.label} group={g} color={GROUP_COLORS[i % GROUP_COLORS.length]} />
            ),
          )}
        </CardContent>
      </Card>

      {/* Benchmark check */}
      <Card data-testid="benchmark-panel">
        <CardHeader className="pb-2 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">Benchmark check — does this price make sense?</CardTitle>
            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-fg))]">
              Provisional benchmarks — pending won-bid history (BRD III-6)
            </span>
          </div>
          <p className="text-xs text-[hsl(var(--muted-fg))]">
            Recent won bids, {MARGIN_BENCHMARKS.region} region — a gut-check before approval, not a
            pricing rule.
          </p>
        </CardHeader>
        <CardContent className="pb-4 space-y-3">
          {/* Verdict badge */}
          <div
            data-testid="bench-verdict"
            data-status={bench.verdict}
            className={cn('rounded-lg border px-3 py-2', verdictMeta.badge)}
          >
            <p className="text-sm font-semibold flex items-center gap-1.5">
              {bench.verdict === 'ok' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <TriangleAlert className="h-4 w-4" />
              )}
              {verdictMeta.verdict}
            </p>
            <p className="text-xs mt-0.5">
              {VERDICT_SUB[bench.verdict](
                formatCents(Math.round(bench.perAcre)),
                MARGIN_BENCHMARKS.perAcre.bandLabel,
              )}
            </p>
          </div>

          {/* Benchmark cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {bench.cards.map((c) => {
              const meta = STATUS_META[c.status]
              return (
                <div
                  key={c.testId}
                  data-testid={c.testId}
                  data-status={c.status}
                  className="rounded-lg border border-[hsl(var(--border))] p-3"
                >
                  <p className="text-xs text-[hsl(var(--muted-fg))]">{c.label}</p>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-sm font-bold text-[hsl(var(--fg))]">{c.value}</p>
                    <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] font-medium', meta.badge)}>
                      {meta.chip}
                    </span>
                  </div>
                  <p className="text-[10px] text-[hsl(var(--muted-fg))] mt-1">
                    Benchmark: {c.bandLabel}
                  </p>
                  <p className="text-[10px] text-[hsl(var(--muted-fg))]">{c.note}</p>
                </div>
              )
            })}
          </div>

          {/* Last 10 tree-work sale prices */}
          <div data-testid="tree-sales-strip" className="rounded-lg border border-[hsl(var(--border))] p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-[hsl(var(--fg))]">Last 10 tree-work sale prices</p>
              <p className="text-[10px] text-[hsl(var(--muted-fg))]">
                median {fmtK(treeMedian)} · range {fmtK(treeSorted[0])}–{fmtK(treeSorted[treeSorted.length - 1])}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MARGIN_BENCHMARKS.treeWorkSaleCents.map((cents, i) => (
                <span
                  key={`${cents}-${i}`}
                  data-testid="tree-chip"
                  className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-fg))]"
                >
                  {fmtK(cents)}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
