// ---------------------------------------------------------------------------
// Page 19 — Client References (variable: picked refs)
// ---------------------------------------------------------------------------

import type { ClientReference } from '@/types/proposal'
import { PrintPage } from './shared'

export function ClientReferencesPage({ refs }: { refs: ClientReference[] }) {
  return (
    <PrintPage data-testid="page-client-references">
      <h1 className="page-title caps alt">Client References</h1>
      <div className="ref-list">
        {refs.map((r, i) => (
          <div className="ref-entry" key={r.id}>
            {i > 0 && <hr className="ref-divider" />}
            <p><strong>Name:</strong> {r.propertyName}</p>
            <p><strong>Services Provided:</strong> {r.servicesProvided}</p>
            <p>
              <strong>Client Information:</strong> {r.contactName}
              {r.contactTitle ? `, ${r.contactTitle}` : ''}
            </p>
            <ul className="ref-sub">
              <li><strong>Phone Number:</strong> {r.phone}</li>
              <li><strong>Email:</strong> {r.email}</li>
              {r.address && <li><strong>Address:</strong> {r.address}</li>}
            </ul>
            <p><strong>Client Since:</strong> {r.clientSinceYear}</p>
          </div>
        ))}
      </div>
    </PrintPage>
  )
}
