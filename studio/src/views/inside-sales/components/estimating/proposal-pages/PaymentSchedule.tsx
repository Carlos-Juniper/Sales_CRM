// ---------------------------------------------------------------------------
// PaymentSchedule — 12-month payment schedule table
//
// Displays the monthly payment breakdown starting from the service start date.
// Uses buildPaymentSchedule from lib/proposal/contract.ts
// ---------------------------------------------------------------------------

import { buildContractRows, buildPaymentSchedule } from '@/lib/proposal/contract'
import type { Estimate } from '@/types/estimating'

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function PaymentSchedule({ estimate }: { estimate: Estimate }) {
  const rows = buildContractRows(estimate)
  
  // Parse serviceStartDate from ISO string to Date
  const serviceStartDate = estimate.serviceStartDate
    ? new Date(estimate.serviceStartDate)
    : null

  const schedule = buildPaymentSchedule(rows, serviceStartDate)

  return (
    <div className="payment-schedule">
      <h2 className="section-title">PAYMENT SCHEDULE</h2>
      <table className="schedule-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((month, i) => (
            <tr key={i}>
              <td className="month-name">{month.month}</td>
              <td className="month-amount">{formatCurrency(month.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
