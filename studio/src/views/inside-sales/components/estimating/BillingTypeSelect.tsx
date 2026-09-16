// ---------------------------------------------------------------------------
// BillingTypeSelect — per-line override of the contract's billing split.
//
// All maintenance work bundles into the contract cost and is broken into the
// Landscape Maintenance Agreement's 12-month payment schedule. That is the
// default for every line, including hand-entered ones with no catalog item.
// This control exists to mark the exception: work billed once, when performed,
// which appears in the contract total but is left out of the monthly schedule.
//
// "Auto" (null) derives from the line's catalog item, and every item in the
// catalog is recurring — so Auto and Recurring resolve the same today. They
// are kept distinct because Auto follows the catalog if an item is ever
// reclassified, whereas Recurring pins this line regardless.
// ---------------------------------------------------------------------------

import { cn } from '@/lib/utils'
import type { SectionService } from '@/types/estimating'

export interface BillingTypeSelectProps {
  label: string
  value: SectionService['billingType']
  onChange: (billingType: 'recurring' | 'one_time' | null) => void
  className?: string
  title?: string
}

export function BillingTypeSelect({
  label,
  value,
  onChange,
  className,
  title,
}: BillingTypeSelectProps) {
  return (
    <select
      aria-label={`Billing type for ${label}`}
      title={
        title ??
        'Contract billing split — Auto and Recurring bundle this line into the ' +
          '12-month payment schedule; One-time bills it when the work is performed.'
      }
      className={cn('rounded-md border px-1.5 text-xs cursor-pointer', className)}
      value={value ?? ''}
      onChange={(e) =>
        onChange(e.target.value === '' ? null : (e.target.value as 'recurring' | 'one_time'))
      }
    >
      <option value="">Auto</option>
      <option value="recurring">Recurring</option>
      <option value="one_time">One-time</option>
    </select>
  )
}
