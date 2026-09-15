// ---------------------------------------------------------------------------
// Page 2 — Rooted in Florida (static)
// ---------------------------------------------------------------------------

import { JuniperLeaves } from '@/components/brand/JuniperLogo'
import { ROOTED_IN_FLORIDA_CONTENT, COMPANY_STATS } from '@/lib/proposal/staticContent'
import { pagePhotoUrl } from '@/lib/proposal/photos'
import type { BranchCoverageGroup } from '@/types/proposal'
import { PrintPage } from './shared'

export function RootedInFlorida({ coverage }: { coverage: BranchCoverageGroup[] }) {
  const content = ROOTED_IN_FLORIDA_CONTENT
  const [lede] = content.body
  const [startedList, todayList] = content.lists ?? []
  const officeCount = coverage.reduce(
    (n, g) => n + g.regions.reduce((m, r) => m + r.branches.length, 0),
    0,
  )
  // Same source as the coverage table overleaf, so the two cannot disagree.
  const stats = officeCount
    ? [...COMPANY_STATS, {
        num: String(officeCount),
        label: 'Operating locations throughout Florida',
      }]
    : COMPANY_STATS
  return (
    <PrintPage data-testid="page-rooted-in-florida" className="rooted-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{content.subheading}</p>
          <h1 className="page-title">{content.heading}</h1>
        </div>
        <JuniperLeaves className="head-leaves" />
      </div>
      <p className="lede">{lede}</p>
      {startedList?.label ? <p className="rooted-label">{startedList.label}</p> : null}
      {/* Reference layout: the two Florida frames stack down the left column and
          a grey panel spans their full height on the right, holding the "where
          we started" prose AND the stat rows. */}
      <div className="rooted-body">
        {/* Reference order reads top-down as where-we-started (the original
            farmhouse) then where-we-are-today (the company photo). */}
        <div className="photo-pair">
          <img src={pagePhotoUrl('rootedFlorida2')} alt="" className="photo" />
          <img src={pagePhotoUrl('rootedFlorida1')} alt="" className="photo" />
        </div>
        <div className="rooted-panel">
          {startedList?.items.map((item, i) => (
            <p key={i}>{item.text}</p>
          ))}
          <div className="stats">
            {stats.map((s) => (
              <div className="stat" key={s.num}>
                <div className="num">{s.num}</div>
                <div className="lbl">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {todayList?.label ? <p className="rooted-label">{todayList.label}</p> : null}
    </PrintPage>
  )
}
