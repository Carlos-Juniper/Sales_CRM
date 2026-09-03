import { useState } from 'react'
import {
  useMaterialCalcs,
  useUpdateBranchSettings,
} from '@/hooks/useBranchSettings'
import type { MaterialCalcRow } from '@/types/estimating'
import { FormStatus, SettingsFormShell } from '../company/formStatus'
import { NumberField, SaveButton } from '../company/SlaForm'

/**
 * Branch material FACTORS: the formula inputs (piece length, roll SF, pallet SF,
 * bag coverage, compaction %, depth tables, …). NEVER unit_cost/unit_sell — those
 * are company catalog economics, out of scope here.
 *
 * Read source is the company-wide material_calcs config (the branch GET does not
 * carry factors — a Slice 5 shape gap); saving PATCHes the changed factors to
 * /branch/{id}, which creates/updates that branch's override row server-side.
 * Only the factors the user actually changes are sent, keyed by materialKey.
 */
export function MaterialFactorsForm({
  aspireBranchId,
}: {
  aspireBranchId: number
}) {
  const { data, isLoading, isError } = useMaterialCalcs()

  if (isLoading) {
    return (
      <SettingsFormShell slug="material-factors" title="Material factors">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError || !data) {
    return (
      <SettingsFormShell slug="material-factors" title="Material factors">
        <p role="alert" className="text-xs text-red-600">
          Could not load material factors.
        </p>
      </SettingsFormShell>
    )
  }
  return <MaterialFields aspireBranchId={aspireBranchId} rows={data} />
}

/** A single editable factor: either a top-level scalar or one depth-table cell. */
interface FactorField {
  materialKey: string
  materialLabel: string
  /** Top-level factor name, e.g. 'rollSf'. */
  factorName: string
  /** Present when the factor is a nested table (depth → value); the cell key. */
  tableKey?: string
  label: string
  original: number
}

/** Flatten a material's `factors` into editable scalar fields (skip anything non-numeric). */
function flattenFactors(row: MaterialCalcRow): FactorField[] {
  const fields: FactorField[] = []
  for (const [factorName, value] of Object.entries(row.factors)) {
    if (typeof value === 'number') {
      fields.push({
        materialKey: row.materialKey,
        materialLabel: row.label,
        factorName,
        label: `${row.label} — ${factorName}`,
        original: value,
      })
    } else if (value && typeof value === 'object') {
      // Nested table (e.g. sfPerTonAtDepthIn: {'2': 160, '3': 108}).
      for (const [tableKey, cell] of Object.entries(value)) {
        if (typeof cell === 'number') {
          fields.push({
            materialKey: row.materialKey,
            materialLabel: row.label,
            factorName,
            tableKey,
            label: `${row.label} — ${factorName} @ ${tableKey}`,
            original: cell,
          })
        }
      }
    }
  }
  return fields
}

function MaterialFields({
  aspireBranchId,
  rows,
}: {
  aspireBranchId: number
  rows: MaterialCalcRow[]
}) {
  const fields = rows.flatMap(flattenFactors)
  // Field id → current string value. Keyed uniquely per material/factor/cell.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [fieldId(f), String(f.original)])),
  )
  const update = useUpdateBranchSettings(aspireBranchId)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Build {materialKey: {factorName | tableKey: value}} for CHANGED fields only.
    const changed: Record<string, Record<string, number | Record<string, number>>> = {}
    for (const f of fields) {
      const next = Number(values[fieldId(f)])
      if (next === f.original) continue
      const bucket = (changed[f.materialKey] ??= {})
      if (f.tableKey !== undefined) {
        const table = (bucket[f.factorName] ??= {}) as Record<string, number>
        table[f.tableKey] = next
      } else {
        bucket[f.factorName] = next
      }
    }
    if (Object.keys(changed).length === 0) return
    update.mutate({ materialFactors: changed })
  }

  return (
    <SettingsFormShell
      slug="material-factors"
      title="Material factors"
      description="Formula inputs for this branch (coverage, piece length, depth tables). Unit cost/sell are managed in the company catalog, not here."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        {fields.map((f) => (
          <NumberField
            key={fieldId(f)}
            id={fieldId(f)}
            label={f.label}
            value={values[fieldId(f)]}
            onChange={(v) => setValues((s) => ({ ...s, [fieldId(f)]: v }))}
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

/** Stable per-field id/testid, unique across materials, factors, and table cells. */
function fieldId(f: FactorField): string {
  const base = `factor-${f.materialKey}-${f.factorName}`
  return f.tableKey !== undefined ? `${base}-${f.tableKey}` : base
}
