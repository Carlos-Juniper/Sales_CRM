// ---------------------------------------------------------------------------
// ContractLines — "Description of Services" tables for the Landscape
// Maintenance Agreement's first page.
//
// The table shape matches the reference (business docs/Pointe Jupiter Yacht
// Club.pdf, p.37): recurring services, a Frequency column, and a bold Annual
// Maintenance Price, then an Optional Services table for one-time line items.
// Neither table carries scope narrative — that's ContractScopeNarrative's job.
// A row whose service has no unit price leaves its money cells blank. A stored
// zero still prints $0.00. Each line prints its own calculated price. The
// Annual Maintenance Price is the recurring sum, and the optional lines sum
// on their own; nothing is adjusted to contractValueCents.
// ---------------------------------------------------------------------------

import { buildContract } from '@/lib/proposal/contract'
import { formatCents } from '@/lib/money'
import type { Estimate } from '@/types/estimating'

function formatPrice(cents: number | null): string {
  return cents == null ? '' : formatCents(cents)
}

export function ContractLines({ estimate }: { estimate: Estimate }) {
  const { recurringRows, oneTimeRows, annualMaintenancePriceCents } = buildContract(estimate)
  if (recurringRows.length === 0 && oneTimeRows.length === 0) return null

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
              <th className="num">Annual Price</th>
            </tr>
          </thead>
          <tbody>
            <tr className="group-row">
              <td colSpan={3}>General Maintenance Services</td>
            </tr>
            {recurringRows.map((row, index) => (
              <tr key={`${row.label}-${index}`}>
                <td>{row.label}</td>
                <td className="num">{row.occurs ?? ''}</td>
                <td className="num">{formatPrice(row.extPriceCents)}</td>
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
                <th className="num">Price per Occurrence</th>
                <th className="num">Annual Price</th>
              </tr>
            </thead>
            <tbody>
              {oneTimeRows.map((row, index) => (
                <tr key={`${row.label}-${index}`}>
                  <td>{row.label}</td>
                  <td className="num">1</td>
                  <td className="num">{formatPrice(row.priceEachCents)}</td>
                  <td className="num">{formatPrice(row.extPriceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
