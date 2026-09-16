// ---------------------------------------------------------------------------
// ContractSignatures — By / Print Name / Date signature blocks for the
// Landscape Maintenance Agreement.
//
// Matches the reference (business docs/Pointe Jupiter Yacht Club.pdf, p.42):
// two blank signature blocks side by side, captioned with the contracting
// party's name below the blank lines. Lines are left blank for wet-ink or a
// future e-signature flow — no signer name is pre-filled.
// ---------------------------------------------------------------------------

import { COMPANY_INFO } from '@/lib/constants'

export function ContractSignatures({ lead }: { lead: { property_name: string } }) {
  return (
    <div className="contract-signatures">
      <div className="sig-block">
        <div className="sig-line">
          <span className="sig-label">By</span>
          <span className="sig-rule" />
        </div>
        <div className="sig-line">
          <span className="sig-label">Print Name</span>
          <span className="sig-rule" />
        </div>
        <div className="sig-line">
          <span className="sig-label">Date</span>
          <span className="sig-rule" />
        </div>
        <div className="sig-caption">{COMPANY_INFO.name}</div>
      </div>

      <div className="sig-block">
        <div className="sig-line">
          <span className="sig-label">By</span>
          <span className="sig-rule" />
        </div>
        <div className="sig-line">
          <span className="sig-label">Print Name</span>
          <span className="sig-rule" />
        </div>
        <div className="sig-line">
          <span className="sig-label">Date</span>
          <span className="sig-rule" />
        </div>
        <div className="sig-caption">{lead.property_name}</div>
      </div>
    </div>
  )
}
