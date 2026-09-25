import type { ReactNode } from 'react'
import { payoutAmountLabel } from '@/lib/commissions'
import type { PayoutDescription } from '@/lib/commissions'

interface PayoutLineProps {
  payout: PayoutDescription
  amountPartial?: boolean
  labelClassName?: string
  amountClassName?: string
  children?: ReactNode
}

export function PayoutLine({
  payout,
  amountPartial,
  labelClassName,
  amountClassName,
  children,
}: PayoutLineProps) {
  return (
    <>
      <span className={labelClassName}>{payout.label}</span>
      {children}
      {payout.amount != null && (
        <span className={amountClassName}>
          {payoutAmountLabel({ amount_cents: payout.amount, amount_partial: amountPartial })}
        </span>
      )}
    </>
  )
}
