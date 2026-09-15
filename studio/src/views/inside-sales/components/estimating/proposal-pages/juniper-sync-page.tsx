// ---------------------------------------------------------------------------
// Optional page: Juniper Sync (static)
// ---------------------------------------------------------------------------

import { JUNIPER_SYNC_CONTENT } from '@/lib/proposal/staticContent'
import { pagePhotoUrl } from '@/lib/proposal/photos'
import { PrintPage, CopyLists } from './shared'

export function JuniperSyncPage() {
  const content = JUNIPER_SYNC_CONTENT
  const [lede, workOrderIntro] = content.body
  const [highlights, workOrder] = content.lists ?? []
  const workOrderItems = workOrder?.items ?? []
  const workOrderHalf = Math.ceil(workOrderItems.length / 2)
  return (
    <PrintPage data-testid="page-juniper-sync" className="sync-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{content.subheading}</p>
          <h1 className="page-title">{content.heading}</h1>
        </div>
        <img
          src={pagePhotoUrl('juniperSyncLogo')}
          alt="Juniper Sync"
          className="head-leaves sync-logo"
        />
      </div>
      <p className="lede">{lede}</p>
      <div className="sync-body">
        <div className="sync-sidebar">
          <CopyLists lists={highlights ? [highlights] : undefined} />
          {content.sidebarNote && (
            <div className="sync-qr-block">
              <img
                src={pagePhotoUrl('juniperSyncQr')}
                alt="QR code for a full tour of Juniper Sync"
                className="sync-qr"
              />
              <p className="sync-sidebar-note">{content.sidebarNote}</p>
            </div>
          )}
        </div>
        <div className="sync-main">
          {workOrder?.label && <h2 className="sub">{workOrder.label}</h2>}
          {workOrderIntro && <p>{workOrderIntro}</p>}
          <div className="sync-worklist">
            <ul className="dot">
              {workOrderItems.slice(0, workOrderHalf).map((item, i) => (
                <li key={i}>{item.text}</li>
              ))}
            </ul>
            <ul className="dot">
              {workOrderItems.slice(workOrderHalf).map((item, i) => (
                <li key={i}>{item.text}</li>
              ))}
            </ul>
          </div>
          <div className="sync-app-photos">
            <img src={pagePhotoUrl('juniperSyncAppSummary')} alt="" />
            <img src={pagePhotoUrl('juniperSyncAppMenu')} alt="" />
          </div>
        </div>
      </div>
    </PrintPage>
  )
}
