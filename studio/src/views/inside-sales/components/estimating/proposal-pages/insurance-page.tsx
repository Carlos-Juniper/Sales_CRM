// ---------------------------------------------------------------------------
// Page 20 — Insurance (static copy + cert scan from config)
//
// The certificate is rendered as an <img>, never an <object>/<embed>. This
// document is printed by headless Chromium (api/proposal_render.py calls
// page.pdf()), and Chromium does NOT rasterize nested PDF plugin content into
// print output — an <object type="application/pdf"> shows correctly in the
// on-screen preview and then prints as a blank box. Two consequences:
//
//   1. licenses_certifications.object_key for kind='insurance' must point at a
//      raster scan (PNG), not the source PDF. scripts/swap_insurance_cert.py
//      uploads both and points the column at the PNG.
//   2. <img> is also what the print readiness gate waits on —
//      ProposalPrintRoute awaits every <img>.decode() before flipping
//      __PROPOSAL_READY__, so the capture cannot beat the certificate.
//
// Same shape as LicenseImage in ./shared, except a failure here is visible:
// a bare heading over white space reads as an oversight to the client, so the
// page says what happened instead of printing an empty well.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { INSURANCE_PAGE_COPY } from '@/lib/proposal/staticContent'
import { useProposalMediaUrl } from '@/hooks/useProposals'
import { PrintPage } from './shared'

export function InsurancePage({
  cert,
}: {
  cert: { id: string; objectKey: string; expiryDate: string; label: string | null } | null
}) {
  const copy = INSURANCE_PAGE_COPY
  const [failed, setFailed] = useState(false)
  const { data } = useProposalMediaUrl(cert?.objectKey ?? null)
  const url = cert && data?.url && !failed ? data.url : null
  return (
    <PrintPage data-testid="page-insurance">
      <p className="eyebrow">Coverage &amp; Compliance</p>
      <h1 className="page-title">{copy.heading}</h1>
      {url ? (
        <img
          src={url}
          alt={cert!.label ?? 'Certificate of Insurance'}
          className="insurance-cert-embed"
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="insurance-cert-error">{copy.unavailable}</p>
      )}
    </PrintPage>
  )
}
