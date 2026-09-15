// ---------------------------------------------------------------------------
// Optional page: Start Up Plan (30-60-90)
//
// Layout mirrors the reference ("business docs/30-60-90 plan example.pdf"):
// a full-bleed hero photo with the title block reversed out over it, then a
// green band running to the footer holding white phase cards under orange
// chevron banners.
//
// Deliberately does NOT reuse the `.sched*` classes it once shared with
// startup-communication.tsx — those encode that page's pill/connector-line
// treatment, which is a different design. Everything here is `.startup-plan-*`.
// ---------------------------------------------------------------------------

import { pagePhotoUrl } from '@/lib/proposal/photos'
import { STARTUP_PLAN_INTRO, STARTUP_PLAN_SEED } from '@/lib/proposal/staticContent'
import type { StartupPlanInput } from '@/types/proposal'
import { PrintPage } from './shared'

export function StartupPlan306090({ startupPlan }: { startupPlan: StartupPlanInput }) {
  const { dayZero, day30 } = STARTUP_PLAN_SEED
  const phases: { title: string; bullets: string[] }[] = [
    { title: 'Day Zero', bullets: dayZero.map((b) => b.text) },
    { title: 'Day 30', bullets: day30.map((b) => b.text) },
    { title: 'Day 60', bullets: startupPlan.day60 },
    { title: 'Day 90', bullets: startupPlan.day90 },
    { title: 'Day 120+', bullets: startupPlan.day120Plus },
    { title: 'Ongoing', bullets: startupPlan.ongoing },
  ].filter((p) => p.bullets.length > 0)

  return (
    <PrintPage data-testid="page-startup-plan" className="startup-plan-page">
      <div className="startup-plan-hero">
        <img src={pagePhotoUrl('startupPlan306090')} alt="" />
        {/* Scrim, not a filter on the <img>: the copy has to stay crisp. */}
        <div className="startup-plan-scrim" />
        <div className="startup-plan-hero-copy">
          <p className="startup-plan-eyebrow">30-60-90 Day</p>
          <h1 className="startup-plan-title">Start Up Plan</h1>
          <p className="startup-plan-intro">{STARTUP_PLAN_INTRO}</p>
        </div>
      </div>
      <div className="startup-plan-band">
        <div className="startup-plan-grid">
          {phases.map((phase) => (
            <div className="startup-plan-card" key={phase.title}>
              <div className="startup-plan-card-head">{phase.title}</div>
              <div className="startup-plan-card-body">
                <ul className="dot">
                  {phase.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PrintPage>
  )
}
