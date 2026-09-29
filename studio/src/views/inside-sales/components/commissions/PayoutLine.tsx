import type { ReactNode } from 'react'
import { payoutAmountLabel } from '@/lib/commissions'

interface PayoutLineProps {
  label: string
  amountCents: number | null
  amountPartial?: boolean
  labelClassName?: string
  amountClassName?: string
  children?: ReactNode
}

export function PayoutLine({
  label,
  amountCents,
  amountPartial,
  labelClassName,
  amountClassName,
  children,
}: PayoutLineProps) {
  return (
    <>
      <span className={labelClassName}>{label}</span>
      {children}
      {amountCents != null && (
        <span className={amountClassName}>
          {payoutAmountLabel({ amount_cents: amountCents, amount_partial: amountPartial })}
        </span>
      )}
    </>
  )
}
