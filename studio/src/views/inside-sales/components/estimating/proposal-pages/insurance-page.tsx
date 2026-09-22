// ---------------------------------------------------------------------------
// Page 20 — Insurance (static copy + cert object/expiry from config)
// ---------------------------------------------------------------------------

import { INSURANCE_PAGE_COPY } from '@/lib/proposal/staticContent'
import { useProposalMediaUrl } from '@/hooks/useProposals'
import { PrintPage } from './shared'

export function InsurancePage({
  cert,
}: {
  cert: { id: string; objectKey: string; expiryDate: string; label: string | null } | null
}) {
  const copy = INSURANCE_PAGE_COPY
  const { data } = useProposalMediaUrl(cert?.objectKey ?? null)
  const url = cert && data?.url ? data.url : null
  return (
    <PrintPage data-testid="page-insurance">
      <p className="eyebrow">Coverage &amp; Compliance</p>
      <h1 className="page-title">{copy.heading}</h1>
      {url && (
        <object
          data={url}
          type="application/pdf"
          className="insurance-cert-embed"
          aria-label={cert!.label ?? 'Certificate of Insurance'}
        />
      )}
    </PrintPage>
  )
}
