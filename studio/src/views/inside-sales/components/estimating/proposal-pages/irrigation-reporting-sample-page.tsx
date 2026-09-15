// ---------------------------------------------------------------------------
// Optional page: Irrigation Reporting Sample — appended after the Landscape
// Irrigation service page. Two real (redacted) sample report screenshots
// side by side, then a short unbulleted list of bold-lead callouts.
// ---------------------------------------------------------------------------

import { IRRIGATION_REPORTING_CONTENT } from '@/lib/proposal/staticContent'
import { pagePhotoUrl } from '@/lib/proposal/photos'
import { PrintPage, CopyLists } from './shared'

export function IrrigationReportingSamplePage() {
  const content = IRRIGATION_REPORTING_CONTENT
  const [lede] = content.body
  return (
    <PrintPage data-testid="page-irrigation-reporting-sample" className="service">
      <p className="eyebrow">Our Services</p>
      <h1 className="page-title">{content.heading}</h1>
      <p className="lede">{lede}</p>
      <div className="reporting-sample-photos">
        <img src={pagePhotoUrl('irrigationInspectionSample')} alt="Sample irrigation inspection report" />
        <img src={pagePhotoUrl('weeklyUpdateSample')} alt="Sample weekly landscaping update" />
      </div>
      <CopyLists lists={content.lists} />
    </PrintPage>
  )
}
