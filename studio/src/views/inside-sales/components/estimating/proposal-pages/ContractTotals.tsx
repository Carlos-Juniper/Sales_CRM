// ---------------------------------------------------------------------------
// ContractTotals — CONTRACT SUMMARY table (annual + monthly totals)
//
// Displays a summary table with:
// - Extended Price (annual total)
// - Sales Tax (always $0.00 for v1)
// - Total Price (annual)
// - Monthly Amount (Total Price / 12)
//
// Uses buildContractRows and buildContractTotals from lib/proposal/contract.ts
// ---------------------------------------------------------------------------

import { buildContractRows, buildContractTotals } from '@/lib/proposal/contract'
import type { Estimate } from '@/types/estimating'

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function ContractTotals({ estimate }: { estimate: Estimate }) {
  const rows = buildContractRows(estimate)
  const totals = buildContractTotals(rows)

  const monthlyAmount = Math.floor(totals.totalPriceCents / 12)

  return (
    <div className="contract-totals">
      <h2 className="section-title">CONTRACT SUMMARY</h2>
      <table className="totals-table">
        <tbody>
          <tr>
            <td className="label">Extended Price:</td>
            <td className="amount">{formatCurrency(totals.extPriceCents)}</td>
          </tr>
          <tr>
            <td className="label">Sales Tax:</td>
            <td className="amount">{formatCurrency(totals.salesTaxCents)}</td>
          </tr>
          <tr className="total-row">
            <td className="label">Total Price (Annual):</td>
            <td className="amount">{formatCurrency(totals.totalPriceCents)}</td>
          </tr>
          <tr className="monthly-row">
            <td className="label">Monthly Amount:</td>
            <td className="amount">{formatCurrency(monthlyAmount)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
