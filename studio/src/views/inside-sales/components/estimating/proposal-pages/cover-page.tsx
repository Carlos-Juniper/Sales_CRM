// ---------------------------------------------------------------------------
// Cover — page 1, carries no page number (numbering starts on the letter)
// ---------------------------------------------------------------------------

import { JuniperLogoFull } from '@/components/brand/JuniperLogo'
import { COMPANY_INFO } from '@/lib/constants'
import { PrintPage, type SignerInfo } from './shared'

// The only page with the frond artwork, and the only page besides the closing
// one with no footer bar.
//
// Only the property name is titled; the reference has no city/state line. The
// date lives in the orange pill at the foot of this page, which is why the
// intro letter no longer prints one.
export function CoverPage({
  lead,
  signer,
}: {
  lead: { property_name: string }
  signer: SignerInfo
}) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return (
    <PrintPage
      data-testid="page-cover"
      hideNumber
      noFooter
      // The date pill is anchored to the sheet, not the padded well — see the
      // `overlay` prop and `.print-page .cover-date` in proposal-print.css.
      overlay={
        <div className="cover-date" data-testid="cover-date">
          {today}
        </div>
      }
    >
      <div className="cover">
        <JuniperLogoFull variant="color" className="cover-mark" title={COMPANY_INFO.name} />
        <p className="cover-eyebrow">Proposal for</p>
        <h1
          className="page-title cover-title"
          // Step the 48.75pt title down one size for long names so it stays on
          // one line (nowrap + ellipsis is the hard backstop). ~22 chars is the
          // one-line budget at full size — "Coral Bay HOA" (13) stays large,
          // "Pointe Jupiter Yacht Club" (25) steps down.
          data-long={lead.property_name.length > 22 ? 'true' : 'false'}
        >
          {lead.property_name}
        </h1>

        <div className="cover-prepared">
          <p className="lbl">Prepared by</p>
          <p className="nm">{signer.name}</p>
        </div>
      </div>
    </PrintPage>
  )
}
