import { useState } from 'react'
import {
  useCatalogItems,
  useUpdateBranchSettings,
} from '@/hooks/useBranchSettings'
import type { CatalogItem } from '@/types/estimating'
import { FormStatus, SettingsFormShell } from '../company/formStatus'
import { NumberField, SaveButton } from '../company/SlaForm'

/**
 * Branch production rates: `catalog_items.production_rate` per maintenance kit
 * (units per labor hour). Read from the catalog-items config endpoint (the
 * branch GET does not carry them — a Slice 5 shape gap); saving PATCHes the
 * changed rates to /branch/{id}, keyed by catalog item id. Only maintenance kits
 * carry a production rate — install kits are quantity-driven, so this form lists
 * `kitType: 'maintenance_hours'` only.
 */
export function ProductionRatesForm({
  aspireBranchId,
}: {
  aspireBranchId: number
}) {
  const { data, isLoading, isError } = useCatalogItems()

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
  if (data.length === 0) {
    return (
      <SettingsFormShell slug="production-rates" title="Production rates">
        <p className="text-xs opacity-60">
          No maintenance kits are configured for this branch yet.
        </p>
      </SettingsFormShell>
    )
  }
  return <ProductionFields aspireBranchId={aspireBranchId} items={data} />
}

function ProductionFields({
  aspireBranchId,
  items,
}: {
  aspireBranchId: number
  items: CatalogItem[]
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((i) => [i.id, i.productionRate == null ? '' : String(i.productionRate)]),
    ),
  )
  const update = useUpdateBranchSettings(aspireBranchId)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const changed: Record<string, number> = {}
    for (const item of items) {
      const raw = values[item.id]
      if (raw.trim() === '') continue
      const next = Number(raw)
      if (next === item.productionRate) continue
      changed[item.id] = next
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
        {items.map((item) => (
          <NumberField
            key={item.id}
            id={`rate-${item.id}`}
            label={item.description}
            value={values[item.id]}
            onChange={(v) => setValues((s) => ({ ...s, [item.id]: v }))}
            min={0}
            step={0.0001}
          />
        ))}
        <SaveButton pending={update.isPending} />
        <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
      </form>
    </SettingsFormShell>
  )
}
