// ---------------------------------------------------------------------------
// Page 3 — Your Local Landscape Experts (static map + variable proximity footer)
// ---------------------------------------------------------------------------

import { LOCAL_EXPERTS_CONTENT } from '@/lib/proposal/staticContent'
import { floridaMapUrl } from '@/lib/proposal/assets'
import type { BranchCoverageGroup, BranchProfile } from '@/types/proposal'
import { PrintPage } from './shared'

export function LocalLandscapeExperts({
  coverage,
  nearbyBranches,
}: {
  coverage: BranchCoverageGroup[]
  nearbyBranches: BranchProfile[]
}) {
  const content = LOCAL_EXPERTS_CONTENT
  // These tables are read against the Florida map behind them, so they list
  // Florida offices only. The five-state footprint is stated on the About Us
  // page. Regions arrive pre-sorted, with any unassigned offices last.
  const floridaRegions = coverage.find((g) => g.state === 'FL')?.regions ?? []
  return (
    <PrintPage data-testid="page-local-landscape-experts" className="experts-page">
      <p className="eyebrow">{content.subheading}</p>
      <h1 className="page-title">{content.heading}</h1>
      <p className="lede">{content.body[0]}</p>

      {/* The map is a transparent layer and the region tables sit on top of its
          left flank, which is open water on the artwork. Both are positioned
          against this block so the composition holds however the lede wraps,
          while everything after it still flows normally. */}
      <div className="experts-map">
        <img
          src={floridaMapUrl()}
          alt="Juniper Florida coverage map"
          className="florida-map"
        />
        <div className="branch-tables" data-testid="branch-coverage">
          {/* Two columns filled round-robin, which reproduces the reference's
              East | West / Central arrangement: each table keeps its own height
              instead of being stretched to a shared grid row. */}
          {[0, 1].map((col) => (
            <div className="branch-col" key={col}>
              {floridaRegions
                .filter((_, i) => i % 2 === col)
                .map((region) => (
                  <table className="branch-tbl" key={region.regionId || 'unassigned'}>
                    <tbody>
                      <tr>
                        <th>{region.regionName || 'Florida Locations'}</th>
                      </tr>
                      {region.branches.map((name) => (
                        <tr key={name}>
                          <td>{name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
            </div>
          ))}
        </div>
      </div>

      {/* Variable footer: 2–3 nearest branch offices */}
      {nearbyBranches.length > 0 && (
        <div className="local-branches">
          <h2 className="sub local-branches-title">Local Branches</h2>
          <div className="local-branches-grid" data-testid="nearby-branches">
            {nearbyBranches.map((b) => (
              <div key={b.aspireBranchId} data-testid={`nearby-branch-${b.aspireBranchId}`}>
                <div className="bname">{b.branchName}</div>
                <div className="baddr">{b.address}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PrintPage>
  )
}
