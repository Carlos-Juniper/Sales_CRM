/**
 * Test-only margin groups for the Dobson Ranch demo fixture.
 *
 * `buildMaintenanceEstimate()` keeps its real labels and prices. Those
 * labels (bed maintenance, irrigation inspection, seasonal color) are not
 * commercial margin groups, and production must fail closed on them.
 * This helper assigns an explicit group so existing KPI and cost totals
 * still include every dollar. Do not copy the map into product mocks.
 */
import type { Estimate } from '@/types/estimating'

const FIXTURE_MARGIN_GROUP: Record<string, string> = {
  Mowing: 'Mowing',
  'Detail / Bed Maintenance': 'Pest Control',
  'Irrigation Inspection': 'Optional Services',
  'Seasonal Color Rotation': 'Subcontractors',
}

export function withMarginGroups<T extends Estimate>(estimate: T): T {
  return {
    ...estimate,
    sections: estimate.sections.map((section) => ({
      ...section,
      services: section.services.map((svc) => ({
        ...svc,
        marginGroup: svc.marginGroup ?? FIXTURE_MARGIN_GROUP[svc.label] ?? null,
      })),
    })),
  }
}
