import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import {
  useBranchSettings,
  useUpdateKitRate,
} from '@/hooks/useBranchSettings'
import type { BranchProductionRate } from '@/api/settings'
import { SettingsFormShell } from '../company/formStatus'
import { NumberField } from '../company/SlaForm'

/**
 * Branch production rates — per-kit, per-branch, save-on-blur (Handoff 54 §4).
 *
 * Each kit row saves independently when the user tabs/clicks away. The backend
 * PATCH appends to `service_kit_rates` (branch-scoped, append-only) rather than
 * mutating the global `service_kits.production_rate`. After each save the
 * branch-settings cache is invalidated so the source badge reflects the new
 * override state.
 */
export function ProductionRatesForm({
  aspireBranchId,
}: {
  aspireBranchId: number
}) {
  const { data, isLoading, isError } = useBranchSettings(aspireBranchId)

  if (isLoading) {
    return (
      <SettingsFormShell slug="production-rates" title="Production rates">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError || !data) {
    return (
      <SettingsFormShell slug="production-rates" title="Production rates">
        <p role="alert" className="text-xs text-red-600">
          Could not load production rates.
        </p>
      </SettingsFormShell>
    )
  }

  const productionRates = data.productionRates ?? []
  if (productionRates.length === 0) {
    return (
      <SettingsFormShell slug="production-rates" title="Production rates">
        <p className="text-xs opacity-60">
          No maintenance kits are configured for this branch yet.
        </p>
      </SettingsFormShell>
    )
  }

  return (
    <SettingsFormShell
      slug="production-rates"
      title="Production rates"
      description="Units of work per labor hour for each maintenance kit. Changes save automatically on blur."
    >
      <div className="space-y-3">
        {productionRates.map((rate) => (
          <KitRateRow
            key={rate.serviceKitId}
            aspireBranchId={aspireBranchId}
            rate={rate}
          />
        ))}
      </div>
    </SettingsFormShell>
  )
}

/** Per-kit save-on-blur row with inline save/error feedback. */
function KitRateRow({
  aspireBranchId,
  rate,
}: {
  aspireBranchId: number
  rate: BranchProductionRate
}) {
  const [draft, setDraft] = useState(
    rate.resolvedRate == null ? '' : String(rate.resolvedRate),
  )
  const [rowStatus, setRowStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const mutation = useUpdateKitRate(aspireBranchId, rate.serviceKitId)

  function handleBlur() {
    const trimmed = draft.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && (!Number.isFinite(next) || next < 0)) return
    // Skip if unchanged.
    if (next === rate.resolvedRate) return
    setRowStatus('idle')
    mutation.mutate(
      { productionRate: next ?? undefined },
      {
        onSuccess: () => setRowStatus('saved'),
        onError: () => setRowStatus('error'),
      },
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium opacity-80">{rate.description}</span>
        <RateSourceBadge serviceKitId={rate.serviceKitId} source={rate.source} />
        {mutation.isPending && (
          <Loader2
            className="h-3 w-3 animate-spin text-[var(--fg)] opacity-40"
            aria-label="Saving…"
          />
        )}
        {!mutation.isPending && rowStatus === 'saved' && (
          <Check
            className="h-3 w-3 text-green-600"
            aria-label="Saved"
          />
        )}
        {!mutation.isPending && rowStatus === 'error' && (
          <X
            className="h-3 w-3 text-red-600"
            aria-label="Save failed"
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <NumberField
          id={`rate-${rate.serviceKitId}`}
          label={rate.description}
          value={draft}
          onChange={(v) => {
            setDraft(v)
            setRowStatus('idle')
          }}
          onBlur={handleBlur}
          min={0}
          step={0.0001}
          placeholder="—"
        />
      </div>
      {!mutation.isPending && rowStatus === 'error' && (
        <p className="text-[10px] text-red-600">Save failed — try again</p>
      )}
    </div>
  )
}

/** Inline inherited/override badge for a single production-rate row. */
function RateSourceBadge({
  serviceKitId,
  source,
}: {
  serviceKitId: string
  source: 'override' | 'inherited'
}) {
  const isOverride = source === 'override'
  return (
    <span
      data-testid={`source-badge-${serviceKitId}`}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        isOverride
          ? 'bg-amber-100 text-amber-800'
          : 'bg-[var(--border)] text-[var(--fg)] opacity-60'
      }`}
    >
      {isOverride ? 'Branch override' : 'Inherited (company-wide)'}
    </span>
  )
}
