// ---------------------------------------------------------------------------
// Contract Page — Landscape Maintenance Agreement for approved/won estimates
//
// Three sections:
// 1. Scope text table (one row per service with narrative)
// 2. CONTRACT SUMMARY (annual/monthly totals)
// 3. PAYMENT SCHEDULE (12-month breakdown)
//
// Only rendered for maintenance estimates with lifecycle approved or won.
// ---------------------------------------------------------------------------

import { PrintPage } from './shared'
import { ContractLines } from './ContractLines'
import { ContractTotals } from './ContractTotals'
import { PaymentSchedule } from './PaymentSchedule'
import type { Estimate } from '@/types/estimating'

export function ContractPage({ estimate }: { estimate: Estimate }) {
  return (
    <>
      {/* Page 1: Service scope narratives */}
      <PrintPage data-testid="page-contract-scope" className="contract">
        <h1 className="page-title">Landscape Maintenance Agreement</h1>
        <p className="contract-intro">
          This agreement outlines the scope of landscape maintenance services to be provided
          by Juniper Landscaping. Services will be performed in a professional manner using
          commercial-grade equipment and trained personnel.
        </p>
        <ContractLines estimate={estimate} />
      </PrintPage>

      {/* Page 2: Contract summary and payment schedule */}
      <PrintPage data-testid="page-contract-summary" className="contract">
        <ContractTotals estimate={estimate} />
        <PaymentSchedule estimate={estimate} />
      </PrintPage>
    </>
  )
}
