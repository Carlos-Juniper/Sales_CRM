// ---------------------------------------------------------------------------
// Handoff 55 §6 — the install editor (install.ts roll-ups) and Margin Analysis
// (margins.ts serviceGroupMargins / installLineCost) read ONE cost basis: the
// component sum, falling back to the kit's embedded cost. They used to
// disagree whenever a line's components had drifted from its embedded cost
// (the fixture's Sod line: embedded 26,900 vs components 25,220).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { buildInstallEstimate } from '@/mocks/estimatingData'
import { contractTotal, groupMargin } from '@/lib/estimating/calc'
import {
  estimateGm,
  estimateRollup,
  estimateSubCostCents,
  sectionRollup,
  serviceRollup,
  serviceTotalCents,
} from '@/lib/estimating/install'
import { installLineCost, serviceGroupMargins } from '@/lib/estimating/margins'

/** The overall GM exactly as MarginAnalysis.tsx derives its KPI card. */
function marginAnalysisGm(estimate: ReturnType<typeof buildInstallEstimate>) {
  const groups = serviceGroupMargins(estimate, 0)
  const cost = groups.reduce((s, g) => s + g.costCents, 0)
  return { cost, gm: groupMargin(contractTotal(estimate), cost) }
}

describe('editor GM === Margin Analysis GM (one fixture)', () => {
  it('agrees at the estimate level on the stale-embedded fixture', () => {
    const est = buildInstallEstimate()
    const ma = marginAnalysisGm(est)
    const editor = estimateRollup(est)
    expect(editor.costCents).toBe(3_053_760)
    expect(ma.cost).toBe(editor.costCents)
    expect(ma.gm).toBe(editor.gm)
    expect(ma.gm).toBe(estimateGm(est))
    expect(estimateSubCostCents(est)).toBe(ma.cost)
  })

  it('agrees line by line and section by section', () => {
    const est = buildInstallEstimate()
    for (const section of est.sections) {
      const lineCosts = section.services.map(installLineCost)
      expect(section.services.map((s) => serviceRollup(s).costCents)).toEqual(lineCosts)
      expect(sectionRollup(section).costCents).toBe(lineCosts.reduce((a, b) => a + b, 0))
    }
  })
})

describe('kit-priced lines with no components price exactly as before', () => {
  it('price is untouched and cost falls back to qty × embedded cost', () => {
    const est = buildInstallEstimate()
    for (const section of est.sections) for (const svc of section.services) svc.components = []

    // Price: TP = qty × unit sell, unchanged by the cost-basis work.
    expect(est.sections.flatMap((s) => s.services).map(serviceTotalCents)).toEqual([
      3_000_000, 350_000, 1_992_000,
    ])
    const rollup = estimateRollup(est)
    expect(rollup.priceCents).toBe(5_342_000)
    expect(rollup.priceCents).toBe(contractTotal(est))
    // Cost: 24×68,750 + 1,400×138 + 48×26,900
    expect(rollup.costCents).toBe(1_650_000 + 193_200 + 1_291_200)
    expect(rollup.gm).toBe(groupMargin(5_342_000, 3_134_400))
    // …and Margin Analysis still agrees on the fallback basis.
    expect(marginAnalysisGm(est).gm).toBe(rollup.gm)
  })
})
