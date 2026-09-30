// ---------------------------------------------------------------------------
// Shared install-grid styling + display reads for InstallEditor and its row
// components (split out so §4/§5 rows live in their own files).
// ---------------------------------------------------------------------------

import type { MarginBands } from '@/types/estimating'
import { marginBand } from '@/lib/estimating/calc'
import { formatCents } from '@/lib/money'
import { UNRESOLVED, coerceNum } from '@/lib/estimating/install'

/** Blue-cell convention: estimator-editable override inputs (legacy Excel). */
export const BLUE_CELL = 'bg-[#eff6ff] border-[#bfdbfe] focus-visible:ring-[#2E7D52]'

export const cellInput =
  'h-7 rounded-md border px-1.5 text-xs text-[hsl(var(--fg))] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors'

/** Shared 9-column grid: Item | Qty | Comp | Hrs | U/P | TP | Tax | Sub cost | GM % */
export const GRID =
  'grid grid-cols-[2.6fr_0.9fr_0.5fr_0.6fr_0.9fr_0.9fr_0.5fr_0.9fr_0.7fr] gap-1.5 items-center'

/** GM% text color from the ONE canonical margin-band config (API-fetched). */
export function gmClass(gm: number, bands: MarginBands): string {
  const band = marginBand(gm, bands)
  if (band === 'good') return 'text-[#2E7D52]'
  if (band === 'ok') return 'text-amber-600'
  return 'text-red-600'
}

/** GM cell class: band color when resolvable, muted for "—". */
export function gmCellClass(gm: number | null, bands: MarginBands): string {
  return gm === null ? 'text-[hsl(var(--muted-fg))]' : gmClass(gm, bands)
}

/** Cents or "—" for an unresolvable value (never a fake $0.00). */
export function centsOrDash(cents: number | null): string {
  return cents === null ? UNRESOLVED : formatCents(cents)
}

/** Blue-cell unit-cost text → integer cents; blank → null (unknown cost). */
export function parseUnitCostInput(raw: string): number | null {
  if (raw.trim() === '') return null
  return Math.round(coerceNum(raw) * 100)
}
