// ---------------------------------------------------------------------------
// ContractLines — "Description of Services" tables for the Landscape
// Maintenance Agreement's first page.
//
// Matches the reference (business docs/Pointe Jupiter Yacht Club.pdf, p.37):
// one table of recurring services with Frequency and Price columns and a bold
// Annual Maintenance Price total row, followed by a separate Optional Services
// table (Frequency / Cost per Occ. / Annual Cost) for one-time line items.
// Neither table carries scope narrative — that's ContractScopeNarrative's job.
// A recurring row whose service has no unit price leaves the Price cell blank.
// ---------------------------------------------------------------------------

import {
  annualMaintenancePrice,
  buildContractRows,
  displayedServicePriceCents,
} from '@/lib/proposal/contract'
import type { Estimate } from '@/types/estimating'

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function ContractLines({ estimate }: { estimate: Estimate }) {
  const rows = buildContractRows(estimate)
  if (rows.length === 0) return null

  const recurringRows = rows.filter((r) => r.isRecurring)
  const oneTimeRows = rows.filter((r) => !r.isRecurring)
  // Same extPriceCents partition the Price column uses. An estimate-level
  // contract-value adjustment is not part of this total.
  const { totalCents: annualMaintenancePriceCents } = annualMaintenancePrice(recurringRows)

  return (
    <div className="contract-lines">
      {recurringRows.length > 0 && (
        <table className="contract-tbl services-tbl">
          <thead>
            <tr>
              <th>Description of Services</th>
              <th className="num">Frequency</th>
              <th className="num">Price</th>
            </tr>
          </thead>
          <tbody>
            <tr className="group-row">
              <td colSpan={3}>General Maintenance Services</td>
            </tr>
            {recurringRows.map((row, i) => {
              const priceCents = displayedServicePriceCents(row)
              return (
                <tr key={i} data-testid="contract-line" data-label={row.label}>
                  <td>{row.label}</td>
                  <td className="num" data-testid="contract-line-frequency">{row.occurs ?? ''}</td>
                  <td className="num" data-testid="contract-line-price">
                    {priceCents == null ? '' : formatCurrency(priceCents)}
                  </td>
                </tr>
              )
            })}
            <tr className="total-row" data-testid="contract-total">
              <td colSpan={2}>Annual Maintenance Price</td>
              <td className="num">{formatCurrency(annualMaintenancePriceCents)}</td>
            </tr>
          </tbody>
        </table>
      )}

      {oneTimeRows.length > 0 && (
        <>
          <div className="optional-services-label">Optional Services</div>
          <table className="contract-tbl optional-tbl">
            <thead>
              <tr>
                <th>Description of Services</th>
                <th className="num">Frequency</th>
                <th className="num">Cost per Occ.</th>
                <th className="num">Annual Cost</th>
              </tr>
            </thead>
            <tbody>
              {oneTimeRows.map((row, i) => (
                <tr key={i}>
                  <td>{row.label}</td>
                  <td className="num">1</td>
                  <td className="num">{formatCurrency(row.priceEachCents)}</td>
                  <td className="num">{formatCurrency(row.extPriceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
