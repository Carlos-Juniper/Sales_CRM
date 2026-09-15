// ---------------------------------------------------------------------------
// Page 20b — Licenses & certifications (from crm.licenses_certifications)
// ---------------------------------------------------------------------------

import { LICENSES_PAGE_COPY } from '@/lib/proposal/staticContent'
import type { LicenseCertification } from '@/types/proposal'
import { PrintPage, LicenseImage } from './shared'

export function LicensesCertificationsPage({
  licenses,
  certifications,
}: {
  licenses: LicenseCertification[]
  certifications: LicenseCertification[]
}) {
  const copy = LICENSES_PAGE_COPY
  const items = [...licenses, ...certifications].filter((it) => it.objectKey)
  return (
    <PrintPage data-testid="page-licenses-certifications">
      <p className="eyebrow">Coverage &amp; Compliance</p>
      <h1 className="page-title">{copy.heading}</h1>

      {/* Expired credentials are filtered out server-side, and only scanned
          credentials (objectKey set) render here, so an empty grid is a real
          possibility. A client reads a bare page as an oversight — the prose
          line reads as an offer. */}
      {items.length > 0 ? (
        <div className="collage license-grid" data-testid="licenses-grid">
          {items.map((it) => (
            <LicenseImage key={it.id} item={it} />
          ))}
        </div>
      ) : (
        <p>{copy.empty}</p>
      )}
    </PrintPage>
  )
}
