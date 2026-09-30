// ---------------------------------------------------------------------------
// The add-item row under an expanded install service line (Handoff 55 §5):
//   • material search (MaterialSearchCombobox) — picks set inventoryId,
//     label, uom and the snapshotted cost;
//   • plain rows with no material link for labor / equipment / subcontractor /
//     other, plus a free-text material / cost line (unchanged behaviour);
//   • "Group same-rate labor" (II-9.7).
// ---------------------------------------------------------------------------

import { Merge } from 'lucide-react'
import type { ComponentKind, MaterialSearchItem } from '@/types/estimating'
import { COMPONENT_KINDS } from '@/lib/estimating/install'
import { MaterialSearchCombobox } from './MaterialSearchCombobox'
import { useServiceItemClassCodes } from './useServiceItemClassCodes'

const PLAIN_ROW_LABEL: Record<ComponentKind, string> = {
  labor: 'Labor line',
  material: 'Material / cost line (free text)',
  equipment: 'Equipment line',
  subcontractor: 'Subcontractor line',
  other: 'Other cost line',
}

export function AddItemRow({
  lineLabel,
  catalogServiceId,
  sectionCategoryId,
  laborGroupable,
  onAddPlain,
  onAddMaterial,
  onGroupLabor,
}: {
  lineLabel: string
  /** The line's catalog service (SectionService.serviceId), if any. */
  catalogServiceId?: string | null
  sectionCategoryId: string | null
  laborGroupable: boolean
  onAddPlain: (kind: ComponentKind) => void
  onAddMaterial: (material: MaterialSearchItem) => void
  onGroupLabor: () => void
}) {
  const codes = useServiceItemClassCodes(catalogServiceId, sectionCategoryId)
  return (
    <div className="flex flex-wrap items-center gap-2.5 py-1.5 pl-12 pr-3 border-t border-[hsl(var(--border))]/40 bg-[hsl(var(--muted))]/30">
      <MaterialSearchCombobox lineLabel={lineLabel} itemClassCodes={codes} onPick={onAddMaterial} />
      <select
        aria-label={`Add labor / cost line for ${lineLabel}`}
        className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-1.5 text-[11px] font-semibold text-[#2E7D52] cursor-pointer"
        value=""
        onChange={(e) => {
          const kind = COMPONENT_KINDS.find((k) => k === e.target.value)
          if (kind) onAddPlain(kind)
        }}
      >
        <option value="">+ Add labor / cost line…</option>
        {COMPONENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {PLAIN_ROW_LABEL[k]}
          </option>
        ))}
      </select>
      {laborGroupable && (
        <button
          type="button"
          onClick={onGroupLabor}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2E7D52] hover:underline cursor-pointer"
        >
          <Merge className="h-3 w-3" />
          Group same-rate labor
        </button>
      )}
    </div>
  )
}
