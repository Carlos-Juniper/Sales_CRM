// ---------------------------------------------------------------------------
// Optional pages: Juniper Mapping (static, two halves)
//
// The two halves are deliberately NOT the same template — the reference deck
// (Coral Bay HOA pp. 32–33) gives each its own composition:
//   pageOne — head + lede, a copy/photo split for Plant Health Assessment, then
//             a full-bleed NDVI image filling the bottom half to the footer.
//   pageTwo — head, a two-up image-quality comparison over a hairline rule,
//             then a two-column row: the four tools stacked left, the
//             before/after pair stacked right.
// ---------------------------------------------------------------------------

import { JUNIPER_MAPPING_CONTENT } from '@/lib/proposal/staticContent'
import { pagePhotoUrl } from '@/lib/proposal/photos'
import { PrintPage } from './shared'

/** Head row shared by both halves: eyebrow + title left, wordmark right. */
function MappingHead({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <div className="page-head">
      <div className="jmap-head-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
      </div>
      <img src={pagePhotoUrl('juniperMappingLogo')} alt="Juniper Mapping" className="jmap-logo" />
    </div>
  )
}

function JuniperMappingPageOne() {
  const content = JUNIPER_MAPPING_CONTENT.pageOne
  const [lede] = content.body
  const plantHealth = content.lists?.[0]
  return (
    <PrintPage data-testid="page-juniper-mapping-1" className="jmap-page jmap-one">
      <MappingHead eyebrow={content.subheading} title={content.heading} />
      {lede && <p className="lede">{lede}</p>}
      <div className="jmap-plant-health">
        <div className="jmap-ph-copy">
          {plantHealth?.label && <h2 className="sub">{plantHealth.label}</h2>}
          {plantHealth?.items.map((item, i) => <p key={i}>{item.text}</p>)}
        </div>
        <div className="jmap-ph-photo">
          <img src={pagePhotoUrl('juniperMappingDroneHero')} alt="" />
        </div>
      </div>
      {/* Full-bleed plant-health map; the "Turf Areas of Concern" label and
          arrow are baked into the image, so no overlay markup is needed. */}
      <div className="jmap-ndvi-bleed">
        <img src={pagePhotoUrl('juniperMappingNdvi')} alt="" />
      </div>
    </PrintPage>
  )
}

function JuniperMappingPageTwo() {
  const content = JUNIPER_MAPPING_CONTENT.pageTwo
  const lists = content.lists ?? []
  // lists = [Image Quality Comparison, …4 tools…, Track Improvements Side-By-Side]
  const comparison = lists[0]
  const tools = lists.slice(1, -1)
  const trackImprovements = lists[lists.length - 1]
  return (
    <PrintPage data-testid="page-juniper-mapping-2" className="jmap-page jmap-two">
      <MappingHead eyebrow={content.subheading} title={content.heading} />
      {comparison?.label && <h2 className="sub">{comparison.label}</h2>}
      {comparison?.items.map((item, i) => <p key={i}>{item.text}</p>)}
      <div className="jmap-comparison">
        <img src={pagePhotoUrl('juniperMappingGoogleEarth')} alt="" />
        <img src={pagePhotoUrl('juniperMappingHighRes')} alt="" />
      </div>
      <div className="jmap-tools-row">
        <div className="jmap-tools">
          {tools.map((tool, i) => (
            <div className="jmap-tool" key={i}>
              {tool.label && <h2 className="sub">{tool.label}</h2>}
              {tool.items.map((item, j) => <p key={j}>{item.text}</p>)}
            </div>
          ))}
        </div>
        <div className="jmap-track">
          {trackImprovements?.label && <h2 className="sub">{trackImprovements.label}</h2>}
          {trackImprovements?.items.map((item, i) => <p key={i}>{item.text}</p>)}
          <div className="jmap-track-photos">
            <img src={pagePhotoUrl('juniperMappingBefore')} alt="" />
            <img src={pagePhotoUrl('juniperMappingAfter')} alt="" />
          </div>
        </div>
      </div>
    </PrintPage>
  )
}

export function JuniperMappingPage({ half }: { half: 'pageOne' | 'pageTwo' }) {
  return half === 'pageOne' ? <JuniperMappingPageOne /> : <JuniperMappingPageTwo />
}
