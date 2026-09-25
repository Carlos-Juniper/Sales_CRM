// ---------------------------------------------------------------------------
// Contract Page — Landscape Maintenance Agreement for approved/won estimates
//
// Matches the structure of the reference (business docs/Pointe Jupiter Yacht
// Club.pdf, p.37-42):
// 1. Itemized pricing table (description, visits/year, unit price, line total)
//    + Annual Maintenance Price, plus an Optional Services table for one-time
//    line items (ContractLines). A maintenance estimate with no section
//    services keeps a single Annual Maintenance Price lump sum.
// 2. Services — one scope-of-work paragraph per unique service
//    (ContractScopeNarrative), paginated.
// 3. Terms & Conditions — static boilerplate, identical on every contract
//    (ContractTerms).
// 4. Payment Schedule + signature blocks (PaymentSchedule, ContractSignatures).
//
// Only rendered for maintenance estimates with lifecycle approved or won.
// ---------------------------------------------------------------------------

import { PrintPage } from './shared'
import { ContractLines } from './ContractLines'
import { ContractScopeNarrative } from './ContractScopeNarrative'
import { ContractTerms } from './ContractTerms'
import { PaymentSchedule } from './PaymentSchedule'
import { ContractSignatures } from './ContractSignatures'
import type { Estimate } from '@/types/estimating'

export function ContractPage({
  estimate,
  lead,
}: {
  estimate: Estimate
  lead: { property_name: string }
}) {
  return (
    <>
      {/* Page 1: itemized pricing, or the lump-sum fallback, plus Optional Services */}
      <PrintPage data-testid="page-contract-scope" className="contract">
        <h1 className="page-title">Landscape Maintenance Agreement</h1>
        {lead.property_name && <p className="contract-property">{lead.property_name}</p>}
        <ContractLines estimate={estimate} />
      </PrintPage>

      {/* Page(s) 2+: scope-of-work narrative, one entry per unique service */}
      <ContractScopeNarrative estimate={estimate} />

      {/* Terms & Conditions — same boilerplate on every contract */}
      <ContractTerms />

      {/* Final page: payment schedule + signatures */}
      <PrintPage data-testid="page-contract-summary" className="contract">
        <PaymentSchedule estimate={estimate} />
        <ContractSignatures lead={lead} />
      </PrintPage>
    </>
  )
}
