// ---------------------------------------------------------------------------
// Optional page: Start Up Plan (30-60-90)
//
// Layout measured from the reference ("business docs/Pointe Jupiter Yacht
// Club.pdf" page 18): a 4in full-bleed hero photo starting at the paper edge
// with the title block reversed out over it, then a green band carrying two
// equal white panels, each split into three columns under a chevron banner.
//
// The page always renders all six phases in the reference's fixed 2-row ×
// 3-column grid — box count and geometry never change with plan length, so
// there is never a short row or a blank band. Day Zero and Day 30 always
// print with their seed copy; Ongoing always prints (it describes what
// continues indefinitely, not a milestone reached by a plan length). Day
// 60/90/120+ print their rep/seed bullets only once the rep's chosen plan
// length reaches them — a phase outside that range still renders its box and
// tab (matching every other box on the page) but with no bullets under it,
// signalling "not part of this engagement" rather than looking unfinished.
//
// Deliberately does NOT reuse the `.sched*` classes it once shared with
// startup-communication.tsx — those encode that page's pill/connector-line
// treatment, which is a different design. Everything here is `.startup-plan-*`.
// ---------------------------------------------------------------------------

import type { CSSProperties } from 'react'

import { pagePhotoUrl } from '@/lib/proposal/photos'
import {
  STARTUP_PLAN_INTRO,
  STARTUP_PLAN_SEED,
  STARTUP_PLAN_TAB_COLORS,
} from '@/lib/proposal/staticContent'
import type { StartupPlanInput } from '@/types/proposal'
import { PrintPage } from './shared'

/** Rep-entered bullets when they supplied any, else the phase's seed copy. */
function pick(entered: string[] | undefined, seed: { text: string }[]): string[] {
  const kept = (entered ?? []).map((b) => b.trim()).filter(Boolean)
  return kept.length > 0 ? kept : seed.map((b) => b.text)
}

export function StartupPlan306090({ startupPlan }: { startupPlan: StartupPlanInput }) {
  const seed = STARTUP_PLAN_SEED
  const maxDays = startupPlan.planMaxDays ?? 30

  const phases: { title: string; bullets: string[] }[] = [
    { title: 'Day Zero', bullets: seed.dayZero.map((b) => b.text) },
    { title: 'Day 30', bullets: seed.day30.map((b) => b.text) },
    { title: 'Day 60', bullets: maxDays >= 60 ? pick(startupPlan.day60, seed.day60) : [] },
    { title: 'Day 90', bullets: maxDays >= 90 ? pick(startupPlan.day90, seed.day90) : [] },
    {
      title: 'Day 120+',
      bullets: maxDays >= 120 ? pick(startupPlan.day120Plus, seed.day120Plus) : [],
    },
    // Always filled, regardless of maxDays — see the file header.
    { title: 'Ongoing', bullets: pick(startupPlan.ongoing, seed.ongoing) },
  ]

  const rows = [phases.slice(0, 3), phases.slice(3)]

  return (
    // noFrond: the hero and the green band cover the whole sheet, so the
    // watermark at z-index 0 never shows through — it would only cost a paint.
    <PrintPage data-testid="page-startup-plan" className="startup-plan-page" noFrond>
      <div className="startup-plan-hero">
        {/* No scrim: the reference sets white type straight onto the photo. */}
        <img src={pagePhotoUrl('startupPlan306090')} alt="" />
        <div className="startup-plan-hero-copy">
          <p className="startup-plan-eyebrow">30-60-90 Day</p>
          <h1 className="startup-plan-title">Start Up Plan</h1>
          <p className="startup-plan-intro">{STARTUP_PLAN_INTRO}</p>
        </div>
      </div>
      <div className="startup-plan-band">
        <div className="startup-plan-rows">
          {rows.map((row, r) => (
            <div className="startup-plan-row" key={r}>
              {row.map((phase, c) => (
                <div className="startup-plan-col" key={phase.title}>
                  {/* Colour arrives inline because nth-child cannot count
                      across two separate row grids. */}
                  <div
                    className="startup-plan-tab"
                    style={
                      { '--startup-tab': STARTUP_PLAN_TAB_COLORS[r * 3 + c] } as CSSProperties
                    }
                  >
                    {phase.title}
                  </div>
                  <ul className="dot">
                    {phase.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </PrintPage>
  )
}
