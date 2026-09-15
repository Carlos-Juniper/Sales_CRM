// ---------------------------------------------------------------------------
// Page 2 — Intro Letter
// ---------------------------------------------------------------------------

import { INTRO_LETTER_CONTENT } from '@/lib/proposal/staticContent'
import { pagePhotoUrl } from '@/lib/proposal/photos'
import { PrintPage, SignerBlock, type SignerInfo } from './shared'

export function IntroLetter({
  lead,
  signer,
}: {
  lead: { property_name: string; contact_name: string | null }
  signer: SignerInfo
}) {
  const content = INTRO_LETTER_CONTENT
  const salutation = content.salutation.replace(
    '{contact first and last name}',
    lead.contact_name ?? lead.property_name,
  )
  // Fill the letter's merge slots from the resolved signer/property.
  const fillMergeFields = (paragraph: string): string =>
    paragraph
      .replace('{property}', lead.property_name)
      .replace('{rep phone}', signer.phone)
      .replace('{rep email}', signer.email)
  // No date line here — the reference puts the date in the cover's orange pill.
  return (
    <PrintPage
      data-testid="page-intro-letter"
      className="letter-page"
      hideNumber
      // Full-bleed band across the foot of the sheet, sitting directly on the
      // footer bar. It rides the overlay slot rather than the well so it can
      // reach both gutters; .letter-page grows the well's bottom padding by the
      // same height so the letter can never run underneath it.
      overlay={
        <div className="letter-photo">
          <img src={pagePhotoUrl('introLetter')} alt="" />
        </div>
      }
    >
      <div className="letter">
        <h2 className="sub salutation" style={{ marginTop: 0 }}>
          {salutation}
        </h2>
        {content.body.map((paragraph, i) => (
          <p key={i}>{fillMergeFields(paragraph)}</p>
        ))}
        <p className="letter-closing">{content.closing}</p>
        <SignerBlock signer={signer} />
      </div>
    </PrintPage>
  )
}
