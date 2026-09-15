// ---------------------------------------------------------------------------
// Juniper Cares — standalone section (§6): its own page, NOT a service under
// OUR SERVICES. Modelled on the CustomerCare static-page pattern.
// ---------------------------------------------------------------------------

import { JUNIPER_CARES_PAGE_CONTENT } from '@/lib/proposal/staticContent'
import { pagePhotoUrl } from '@/lib/proposal/photos'
import { PrintPage, CopyLists, splitColumns } from './shared'

export function JuniperCaresPage() {
  const content = JUNIPER_CARES_PAGE_CONTENT
  const [lede, ...rest] = content.body
  return (
    <PrintPage data-testid="page-juniper-cares" className="cares-page">
      <div className="page-head">
        <div>
          {content.subheading && <p className="eyebrow">{content.subheading}</p>}
          <h1 className="page-title">{content.heading}</h1>
        </div>
      </div>
      <p className="lede">{lede}</p>
      <div className="cols-2">
        {splitColumns(rest).map((column, i) => (
          <div key={i}>
            {column.map((para, j) => (
              <p key={j}>{para}</p>
            ))}
          </div>
        ))}
      </div>
      <CopyLists lists={content.lists} />
      <div className="photo-pair">
        <img src={pagePhotoUrl('juniperCares1')} alt="" className="photo" />
        <img src={pagePhotoUrl('juniperCares2')} alt="" className="photo" />
      </div>
    </PrintPage>
  )
}
