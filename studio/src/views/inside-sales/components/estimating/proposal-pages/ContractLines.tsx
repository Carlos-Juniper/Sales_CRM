// ---------------------------------------------------------------------------
// ContractLines — itemized pricing for the Landscape Maintenance Agreement's
// first page.
//
// Recurring services (the contract's Annual Maintenance Price) render as one
// row per section service: description, visits per year, unit price when the
// line has one, and the line total from maintServiceLine. Subtotal, sales tax
// (only when a row actually carries tax), and Annual Maintenance Price follow.
// That total is the same figure the page used to show as a single lump sum,
// and it matches the payment-schedule base when tax is zero.
//
// One-time lines stay on the Optional Services table. They were already
// priced per occurrence and are not part of the annual maintenance total.
//
// When the estimate has no section services at all, the page keeps a single
// Annual Maintenance Price row taken from the persisted contract value.
// Nothing is invented to fill description, frequency, or unit price.
// ---------------------------------------------------------------------------

import {
  buildContractRows,
  buildContractTotals,
  buildPricingFooter,
  type PricingFooterLine,
} from '@/lib/proposal/contract'
import type { Estimate } from '@/types/estimating'

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function FooterRows({ lines, colSpan }: { lines: PricingFooterLine[]; colSpan: number }) {
  return (
    <>
      {lines.map((line) => (
        <tr
          key={line.kind}
          className={line.kind === 'total' ? 'total-row' : 'summary-row'}
          data-testid={
            line.kind === 'subtotal'
              ? 'contract-subtotal'
              : line.kind === 'tax'
                ? 'contract-tax'
                : 'contract-total'
          }
        >
          <td colSpan={colSpan}>{line.label}</td>
          <td className="num">{formatCurrency(line.amountCents)}</td>
        </tr>
      ))}
    </>
  )
}

function LumpSumContractTotal({ cents }: { cents: number }) {
  return (
    <div className="contract-lines">
      <table className="contract-tbl services-tbl" data-testid="contract-pricing-lump-sum">
        <thead>
          <tr>
            <th>Description of Services</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="total-row">
            <td>Annual Maintenance Price</td>
            <td className="num" data-testid="contract-total">
              {formatCurrency(cents)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function ContractLines({ estimate }: { estimate: Estimate }) {
  const rows = buildContractRows(estimate)
  if (rows.length === 0) {
    if (!estimate.contractValueCents) return null
    return <LumpSumContractTotal cents={estimate.contractValueCents} />
  }

  const recurringRows = rows.filter((r) => r.isRecurring)
  const oneTimeRows = rows.filter((r) => !r.isRecurring)
  const totals = buildContractTotals(recurringRows)
  const footer = buildPricingFooter(totals)
  const showUnitPrice = recurringRows.some((row) => row.unitPriceCents != null)
  const columnCount = showUnitPrice ? 4 : 3

  return (
    <div className="contract-lines">
      {recurringRows.length > 0 && (
        <table className="contract-tbl services-tbl" data-testid="contract-pricing-table">
          <thead>
            <tr>
              <th>Description of Services</th>
              <th className="num">Frequency</th>
              {showUnitPrice && <th className="num">Unit Price</th>}
              <th className="num">Line Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="group-row">
              <td colSpan={columnCount}>General Maintenance Services</td>
            </tr>
            {recurringRows.map((row, index) => (
              <tr key={`${row.label}-${index}`} data-testid="contract-line" data-label={row.label}>
                <td>{row.label}</td>
                <td className="num" data-testid="contract-line-frequency">
                  {row.occurs ?? ''}
                </td>
                {showUnitPrice && (
                  <td className="num" data-testid="contract-line-unit">
                    {row.unitPriceCents == null ? '' : formatCurrency(row.unitPriceCents)}
                  </td>
                )}
                <td className="num" data-testid="contract-line-total">
                  {formatCurrency(row.extPriceCents)}
                </td>
              </tr>
            ))}
            <FooterRows lines={footer} colSpan={columnCount - 1} />
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
              {oneTimeRows.map((row, index) => (
                <tr key={`${row.label}-${index}`} data-testid="contract-optional-line" data-label={row.label}>
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
