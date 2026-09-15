// ---------------------------------------------------------------------------
// Page 22 — Closing (mirrors the Cover: mark + tagline up top, contact block
// and CTA anchored near the foot)
// ---------------------------------------------------------------------------

import { JuniperLogoFull } from '@/components/brand/JuniperLogo'
import { COMPANY_INFO, formatWebsiteLabel } from '@/lib/constants'
import { PrintPage, type SignerInfo } from './shared'

// Closing page carries no footer bar, matching the reference (the only other
// page without one is the cover). The reference closing sheet is much plainer
// than a letter — no "Thank You" headline, no photo, no body copy — just the
// mark, the brand tagline, one line of goodwill copy, the rep's contact block,
// and the junipercares.com CTA.
export function ThankYouPage({ signer }: { signer: SignerInfo }) {
  const websiteLabel = formatWebsiteLabel(COMPANY_INFO.website).toUpperCase()
  return (
    <PrintPage data-testid="page-thank-you" noFooter>
      <div className="closing">
        <JuniperLogoFull variant="color" className="closing-mark" title={COMPANY_INFO.name} />
        <h1 className="page-title closing-title">We look forward to working with you!</h1>
        <div className="closing-contact">
          <p className="signer-lines">
            <strong>{signer.name}</strong>
            <br />
            {signer.title}
            {signer.phone && (
              <>
                <br />
                {signer.phone}
              </>
            )}
            {signer.email && (
              <>
                <br />
                {signer.email}
              </>
            )}
            {signer.branchAddress && (
              <>
                <br />
                {signer.branchAddress}
              </>
            )}
          </p>
        </div>
        {websiteLabel && (
          <a className="closing-cta" href={COMPANY_INFO.website}>
            {websiteLabel}
          </a>
        )}
      </div>
    </PrintPage>
  )
}
