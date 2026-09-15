// ---------------------------------------------------------------------------
// Portfolio — one sheet per property (Handoff 48 §3)
//
// Each photographed property gets its own sheet: the property name (page-title),
// a single flattened image (photoObjectKeys[0] only — Caitlyn's export bakes the
// city and composition into the PNG), and the standard footer. No eyebrow, no
// capbar, no city line. The `portfolio` class makes the well a column flex
// container so the image sizes to whatever the title leaves (§4).
//
// Extra photo keys are ignored in the document, not deleted — Settings keeps the
// full array and nothing is destroyed.
// ---------------------------------------------------------------------------

import type { PortfolioProperty } from '@/types/proposal'
import { PrintPage, PortfolioPhoto } from './shared'

export function PortfolioPropertyPage({ property }: { property: PortfolioProperty }) {
  // W5g: the rasterized portfolio image bakes in the brand eyebrow, title,
  // frond watermark, and city bar — but its bottom bar carries no logo or page
  // number. The real footer intentionally renders over that baked-in bar so the
  // logo and page count are present. noFrond suppresses the frond watermark
  // overlay (which would otherwise double the frond); noFooter is NOT set.
  return (
    <PrintPage
      data-testid={`page-portfolio-${property.id}`}
      className="portfolio-full-bleed"
      noFrond
    >
      <PortfolioPhoto
        objectKey={property.photoObjectKeys[0]}
        alt={property.name}
        loadedClassName="portfolio-full-bleed-img"
      />
    </PrintPage>
  )
}
