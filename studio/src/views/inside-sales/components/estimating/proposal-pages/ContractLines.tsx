// ---------------------------------------------------------------------------
// ContractLines — "Description of Services" tables for the Landscape
// Maintenance Agreement's first page.
//
// The table shape matches the reference (business docs/Pointe Jupiter Yacht
// Club.pdf, p.37): recurring services, a Frequency column, and a bold Annual
// Maintenance Price, then an Optional Services table (Frequency / Cost per
// Occ. / Annual Cost) for one-time line items. The Price column on the
// recurring table was added at Carlos's request; it is not in that reference.
// Neither table carries scope narrative — that's ContractScopeNarrative's job.
// A row whose service has no unit price leaves its money cells blank. A stored
// zero still prints $0.00. When the estimate carries an approved contract
// value, every priced line — recurring and optional — is scaled by
// contractValueCents / contractTotal. The Annual Maintenance Price is the
// scaled recurring subtotal, not the whole approved value.
// ---------------------------------------------------------------------------

import {
  buildContractRows,
  buildContractTotals,
  scaleRowsToContractValue,
} from '@/lib/proposal/contract'
import { formatCents } from '@/lib/proposal/formatCents'
import type { Estimate } from '@/types/estimating'

export function ContractLines({ estimate }: { estimate: Estimate }) {
  const rows = buildContractRows(estimate)
  if (rows.length === 0) return null

  // One ratio for every line. A missing approved value leaves the rows
  // unscaled; scaleRowsToContractValue also leaves a zero contract total alone.
  const scaled = scaleRowsToContractValue(rows, estimate.contractValueCents ?? null)
  const recurringRows = scaled.filter((r) => r.isRecurring)
  const oneTimeRows = scaled.filter((r) => !r.isRecurring)
  const annualMaintenancePriceCents = buildContractTotals(recurringRows).extPriceCents

  return (
    <div className="contract-lines">
      {recurringRows.length > 0 && (
        <table className="contract-tbl services-tbl">
          <colgroup>
            <col style={{ width: '58%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '24%' }} />
          </colgroup>
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
            {recurringRows.map((row, i) => (
              <tr key={i}>
                <td>{row.label}</td>
                <td className="num">{row.occurs ?? ''}</td>
                <td className="num">
                  {row.hasUnitPrice ? formatCents(row.extPriceCents) : ''}
                </td>
              </tr>
            ))}
            <tr className="total-row">
              <td colSpan={2}>Annual Maintenance Price</td>
              <td className="num">{formatCents(annualMaintenancePriceCents)}</td>
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
                  <td className="num">{row.hasUnitPrice ? formatCents(row.priceEachCents) : ''}</td>
                  <td className="num">{row.hasUnitPrice ? formatCents(row.extPriceCents) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
