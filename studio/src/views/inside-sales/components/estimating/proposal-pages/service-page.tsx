// ---------------------------------------------------------------------------
// Our Services — one detail page per service key.
// ---------------------------------------------------------------------------

import { SERVICES_CONTENT } from '@/lib/proposal/staticContent'
import { serviceDetailPhotoUrls, pagePhotoUrl } from '@/lib/proposal/photos'
import {
  PrintPage,
  CopyLists,
  ServicePhotoCluster,
  splitColumns,
  type ServiceKey,
} from './shared'

const SERVICE_PAGE_LAYOUT: Partial<Record<ServiceKey, 'split'>> = {
  services_irrigation: 'split',
}

export function ServicePage({ serviceKey }: { serviceKey: ServiceKey }) {
  const content = SERVICES_CONTENT[serviceKey]
  const [lede, ...rest] = content.body
  // §6: Safety & Training's headline stands alone — no "OUR SERVICES" eyebrow.
  const showEyebrow = serviceKey !== 'services_safety_training'
  const layout = SERVICE_PAGE_LAYOUT[serviceKey]

  if (layout === 'split') {
    const photos = serviceDetailPhotoUrls(serviceKey)
    return (
      <PrintPage data-testid={`page-service-${serviceKey}`} className="service">
        {showEyebrow && <p className="eyebrow">Our Services</p>}
        <h1 className="page-title caps">{content.title}</h1>
        {content.subhead && <p className="lede quote">{content.subhead}</p>}
        {content.subhead2 && <p className="copy-list-label-green">{content.subhead2}</p>}
        <p>{lede}</p>
        <div className="service-split">
          <div className="service-split-copy">
            {rest.map((para, i) => <p key={i}>{para}</p>)}
            <CopyLists lists={content.lists} />
          </div>
          <div className="service-photo-col">
            {photos.map((url, i) => <img key={i} src={url} alt="" />)}
          </div>
        </div>
      </PrintPage>
    )
  }

  const isArboriculture = serviceKey === 'services_arboriculture'

  return (
    <PrintPage data-testid={`page-service-${serviceKey}`} className="service">
      {isArboriculture ? (
        <div className="page-head">
          <div>
            {showEyebrow && <p className="eyebrow">Our Services</p>}
            <h1 className="page-title caps">{content.title}</h1>
          </div>
          <img
            src={pagePhotoUrl('certifiedArboristBadge')}
            alt="ISA Certified Arborist"
            className="service-arborist-badge"
          />
        </div>
      ) : (
        <>
          {showEyebrow && <p className="eyebrow">Our Services</p>}
          {/* §6: service headlines render ALL CAPS under OUR SERVICES. */}
          <h1 className="page-title caps">{content.title}</h1>
        </>
      )}
      {content.subhead && <p className="lede quote">{content.subhead}</p>}
      <p>{lede}</p>
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
      {/* Photos run after the copy, not before it — the reference proposal
          (Pointe Jupiter Yacht Club, p6) puts every light-content service
          page's photography below its text and list. */}
      <ServicePhotoCluster serviceKey={serviceKey} />
    </PrintPage>
  )
}
