import { useState } from 'react'
import {
  useBranchSettings,
  useUpdateBranchSettings,
} from '@/hooks/useBranchSettings'
import type { BranchProductionRate } from '@/api/settings'
import { FormStatus, SettingsFormShell } from '../company/formStatus'
import { NumberField, SaveButton } from '../company/SlaForm'

/**
 * Branch production rates: `catalog_items.production_rate` per maintenance kit
 * (units per labor hour). Read from the enriched branch GET (commits 32c58fe /
 * 2750a9d) which returns `productionRates` with a `source` field per row.
 * `source` is currently always 'inherited' (no per-branch rate column yet —
 * backend follow-up #16), but we render the badge from the field regardless.
 * Saving PATCHes the changed rates to /branch/{id}, keyed by catalog item id.
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
    <ProductionFields aspireBranchId={aspireBranchId} rates={productionRates} />
  )
}

function ProductionFields({
  aspireBranchId,
  rates,
}: {
  aspireBranchId: number
  rates: BranchProductionRate[]
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rates.map((r) => [
        r.catalogItemId,
        r.productionRate == null ? '' : String(r.productionRate),
      ]),
    ),
  )
  const update = useUpdateBranchSettings(aspireBranchId)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const changed: Record<string, number> = {}
    for (const rate of rates) {
      const raw = values[rate.catalogItemId]
      if (raw == null || raw.trim() === '') continue
      const next = Number(raw)
      if (next === rate.productionRate) continue
      changed[rate.catalogItemId] = next
    }
    if (Object.keys(changed).length === 0) return
    update.mutate({ productionRates: changed })
  }

  return (
    <SettingsFormShell
      slug="production-rates"
      title="Production rates"
      description="Units of work per labor hour for each maintenance kit."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        {rates.map((rate) => (
          <div key={rate.catalogItemId} className="space-y-1">
            {/* Source badge driven by the field value — never hardcoded. */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium opacity-80">
                {rate.description}
              </span>
              <RateSourceBadge
                catalogItemId={rate.catalogItemId}
                source={rate.source}
              />
            </div>
            <NumberField
              id={`rate-${rate.catalogItemId}`}
              label={rate.description}
              value={values[rate.catalogItemId]}
              onChange={(v) =>
                setValues((s) => ({ ...s, [rate.catalogItemId]: v }))
              }
              min={0}
              step={0.0001}
            />
          </div>
        ))}
        <SaveButton pending={update.isPending} />
        <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
      </form>
    </SettingsFormShell>
  )
}

/** Inline inherited/override badge for a single production-rate row. */
function RateSourceBadge({
  catalogItemId,
  source,
}: {
  catalogItemId: string
  source: 'override' | 'inherited'
}) {
  const isOverride = source === 'override'
  return (
    <span
      data-testid={`source-badge-${catalogItemId}`}
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
