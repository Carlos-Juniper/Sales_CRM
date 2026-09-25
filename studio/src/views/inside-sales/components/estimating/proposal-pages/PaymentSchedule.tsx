// ---------------------------------------------------------------------------
// PaymentSchedule — PAYMENT SCHEDULE table for the Landscape Maintenance
// Agreement's final page.
//
// Matches the reference (business docs/Pointe Jupiter Yacht Club.pdf, p.42):
// one row per month (Schedule / Price / Sales Tax / Total Price) starting
// from the service start date, with a totals row. The annual base is the
// approved contract value (the same number as Annual Maintenance Price).
// ---------------------------------------------------------------------------

import { buildApprovedPaymentSchedule, buildContractRows } from '@/lib/proposal/contract'
import { formatCents } from '@/lib/proposal/formatCents'
import type { Estimate } from '@/types/estimating'

export function PaymentSchedule({ estimate }: { estimate: Estimate }) {
  const rows = buildContractRows(estimate)

  // Parse serviceStartDate from ISO string to Date
  const serviceStartDate = estimate.serviceStartDate
    ? new Date(estimate.serviceStartDate)
    : null

  // Same approved number as the Annual Maintenance Price, so the twelve
  // months and their total agree with the contract value to the cent.
  const schedule = buildApprovedPaymentSchedule(
    rows,
    estimate.contractValueCents ?? null,
    serviceStartDate,
  )
  const totalCents = schedule.reduce((sum, m) => sum + m.amountCents, 0)

  return (
    <div className="payment-schedule">
      <h2 className="section-title">Payment Schedule</h2>
      <table className="contract-tbl schedule-tbl">
        <thead>
          <tr>
            <th>Schedule</th>
            <th className="num">Price</th>
            <th className="num">Sales Tax</th>
            <th className="num">Total Price</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((month, i) => (
            <tr key={i}>
              <td>{month.month}</td>
              <td className="num">{formatCents(month.amountCents)}</td>
              <td className="num">{formatCents(0)}</td>
              <td className="num">{formatCents(month.amountCents)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Total</td>
            <td className="num">{formatCents(totalCents)}</td>
            <td className="num">{formatCents(0)}</td>
            <td className="num">{formatCents(totalCents)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
