// ---------------------------------------------------------------------------
// DisciplineSelect (Handoff 29) — per-line LS/IR override for the ITB EST
// LS $ / EST IR $ split. Shared by SectionCard (maintenance) and
// InstallEditor (install) — the one place this control is defined.
// ---------------------------------------------------------------------------

import { cn } from '@/lib/utils'
import type { SectionService } from '@/types/estimating'

export interface DisciplineSelectProps {
  label: string
  value: SectionService['discipline']
  onChange: (discipline: 'landscape' | 'irrigation' | null) => void
  className?: string
  title?: string
}

export function DisciplineSelect({ label, value, onChange, className, title }: DisciplineSelectProps) {
  return (
    <select
      aria-label={`Discipline for ${label}`}
      title={title ?? 'LS/IR split override — Auto derives from the catalog item'}
      className={cn(
        'rounded-md border px-1.5 text-xs cursor-pointer',
        className,
      )}
      value={value ?? ''}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : (e.target.value as 'landscape' | 'irrigation'))
      }
    >
      <option value="">Auto</option>
      <option value="landscape">LS</option>
      <option value="irrigation">IR</option>
    </select>
  )
}
