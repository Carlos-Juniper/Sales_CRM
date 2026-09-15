// ---------------------------------------------------------------------------
// Service overview grid — the reference's most distinctive page layout
//
// Three columns of photos, each with an orange square badge holding a white
// line-art icon that overlaps and hangs outside the photo's top-left corner,
// then a green service name and an orange-dot list.
//
// Icons are lucide line-art rather than the reference's bespoke set, which we
// do not have. They are stroked white at 1.75 by the stylesheet, so they read
// as intended artwork rather than placeholder boxes — but they ARE stand-ins
// and should be swapped when the real icons arrive.
//
// This is the six-capability overview (Design / Build / Maintain / Technology /
// Storm Response / Aquatics), not the eleven service-detail pages. Six cells is
// exactly two rows of three, which fits one sheet with the header — so it is a
// single page, mapped straight off SERVICE_OVERVIEW_CATEGORIES with no
// pagination. The per-service detail pages still cover all eleven keys.
// ---------------------------------------------------------------------------

import {
  PencilRuler, Leaf, Shovel, CloudLightning, Waves, Cpu,
  type LucideIcon,
} from 'lucide-react'
import { SERVICE_OVERVIEW_CATEGORIES } from '@/lib/proposal/staticContent'
import { overviewCategoryPhotoUrl } from '@/lib/proposal/photos'
import { PrintPage } from './shared'

// Icon per capability group. Keyed by the stable `key` on
// SERVICE_OVERVIEW_CATEGORIES. Same lucide stand-in treatment as SERVICE_ICONS.
const OVERVIEW_ICONS: Record<string, LucideIcon> = {
  design: PencilRuler,
  build: Shovel,
  maintain: Leaf,
  technology: Cpu,
  storm_response: CloudLightning,
  aquatics: Waves,
}

export function ServiceOverviewPage() {
  return (
    <PrintPage data-testid="page-services-overview">
      {/* No leaf mark here. At its corrected 1.75 x 1.03in it reaches down to
          where the first row of icon badges sits, and the reference's own
          service-grid page carries no mark either. */}
      <p className="eyebrow">Our Services</p>
      <h1 className="page-title">Full Service Landscape Company</h1>

      <div className="service-grid">
        {SERVICE_OVERVIEW_CATEGORIES.map((cat) => {
          const Icon = OVERVIEW_ICONS[cat.key]
          return (
            <div className="service-cell" key={cat.key} data-testid={`service-cell-${cat.key}`}>
              <div className="shot">
                <img
                  className="photo"
                  src={overviewCategoryPhotoUrl(cat.key)}
                  /* Decorative: the category is already named by the <h2>
                     directly beneath, so alt text here would just repeat it. */
                  alt=""
                />
                <div className="badge">
                  <Icon />
                </div>
              </div>
              <h2 className="service-name">{cat.title}</h2>
              <ul className="dot">
                {cat.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </PrintPage>
  )
}
