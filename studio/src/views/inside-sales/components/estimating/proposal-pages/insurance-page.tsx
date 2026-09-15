// ---------------------------------------------------------------------------
// Page 20 — Insurance (static copy + cert object/expiry from config)
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
  const [imgError, setImgError] = useState(false)
  const { data } = useProposalMediaUrl(cert?.objectKey ?? null)
  const showImage = !!cert && !!data?.url && !imgError
  return (
    <PrintPage data-testid="page-insurance">
      <p className="eyebrow">Coverage &amp; Compliance</p>
      <h1 className="page-title">{copy.heading}</h1>
      {showImage ? (
        <img
          src={data!.url}
          alt={cert!.label ?? 'Certificate of Insurance'}
          className="insurance-cert-img"
          onError={() => setImgError(true)}
        />
      ) : (
        <p>Our current certificate of insurance is available on request.</p>
      )}
    </PrintPage>
  )
}
