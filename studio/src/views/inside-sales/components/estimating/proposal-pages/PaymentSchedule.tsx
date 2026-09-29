// ---------------------------------------------------------------------------
// PaymentSchedule — payment schedule table for the Landscape Maintenance
// Agreement's final page.
//
// Matches the reference (business docs/Pointe Jupiter Yacht Club.pdf, p.42):
// one row per month (Schedule / Price / Sales Tax / Total Price) starting
// from the service start date, with a totals row. The annual base is the
// recurring maintenance total from buildContract.
// ---------------------------------------------------------------------------

import { buildContract } from '@/lib/proposal/contract'
import { formatCents } from '@/lib/money'
import type { Estimate } from '@/types/estimating'

export function PaymentSchedule({ estimate }: { estimate: Estimate }) {
  const { schedule, annualMaintenancePriceCents } = buildContract(estimate)
  const noTax = formatCents(0)
  const total = formatCents(annualMaintenancePriceCents)

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
          {schedule.map((month) => (
            <tr key={month.month}>
              <td>{month.month}</td>
              <td className="num">{formatCents(month.amountCents)}</td>
              <td className="num">{noTax}</td>
              <td className="num">{formatCents(month.amountCents)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Total</td>
            <td className="num">{total}</td>
            <td className="num">{noTax}</td>
            <td className="num">{total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
