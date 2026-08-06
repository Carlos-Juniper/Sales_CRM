// ---------------------------------------------------------------------------
// Handoff 17 — component CRUD + lifecycle endpoints on the typed client
// (MSW round-trip). Mirrors the backend surface added in api/estimating.py.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { estimatingApi } from '@/api/estimating'
import { buildInstallEstimate, buildMaintenanceEstimate, toCreatePayload } from '@/mocks/estimatingData'

async function createInstall() {
  const created = await estimatingApi.create(toCreatePayload(buildInstallEstimate()))
  const sec = created.sections[0]
  const svc = sec.services.find((sv) => sv.components.length > 0)!
  return { created, sec, svc }
}

describe('estimatingApi — component CRUD (Handoff 17)', () => {
  it('creates a component and it survives a reload', async () => {
    const { created, sec, svc } = await createInstall()
    const comp = await estimatingApi.createComponent(created.id, sec.id, svc.id, {
      kind: 'material',
      label: 'Mulch',
      qty: 12,
      unitCostCents: 900,
      hours: null,
      sortOrder: svc.components.length,
    })
    expect(comp.id).toBeTruthy()
    expect(comp.sectionServiceId).toBe(svc.id)

    const fetched = await estimatingApi.get(created.id)
    const labels = fetched.sections[0].services
      .find((sv) => sv.id === svc.id)!
      .components.map((c) => c.label)
    expect(labels).toContain('Mulch')
  })

  it('patches a component and it survives a reload', async () => {
    const { created, sec, svc } = await createInstall()
    const target = svc.components[0]
    const updated = await estimatingApi.updateComponent(created.id, sec.id, svc.id, target.id, {
      qty: 16,
      unitCostCents: 5000,
    })
    expect(updated.qty).toBe(16)

    const fetched = await estimatingApi.get(created.id)
    const comp = fetched.sections[0].services
      .find((sv) => sv.id === svc.id)!
      .components.find((c) => c.id === target.id)!
    expect(comp.qty).toBe(16)
    expect(comp.unitCostCents).toBe(5000)
  })

  it('deletes a component and it is gone after a reload', async () => {
    const { created, sec, svc } = await createInstall()
    const target = svc.components[0]
    await estimatingApi.deleteComponent(created.id, sec.id, svc.id, target.id)

    const fetched = await estimatingApi.get(created.id)
    const ids = fetched.sections[0].services
      .find((sv) => sv.id === svc.id)!
      .components.map((c) => c.id)
    expect(ids).not.toContain(target.id)
  })
})

describe('estimatingApi — lifecycle flip persists server-side (Handoff 17 §2.3)', () => {
  it('WON flip updates lifecycle + aspireOwner and writes an audit edge', async () => {
    const created = await estimatingApi.create(toCreatePayload(buildMaintenanceEstimate()))
    const res = await estimatingApi.setLifecycle(created.id, 'won')
    expect(res.estimate.lifecycle).toBe('won')
    expect(res.estimate.aspireOwner).toBe('crm')
    expect(res.transition).toMatchObject({ from: 'lifecycle:bidding', to: 'lifecycle:won' })

    // survives reload; the edge landed in the ONE audit trail
    const fetched = await estimatingApi.get(created.id)
    expect(fetched.lifecycle).toBe('won')
    expect(fetched.aspireOwner).toBe('crm')
    const audit = await estimatingApi.listStatusTransitions(created.id)
    expect(audit.some((t) => t.from === 'lifecycle:bidding' && t.to === 'lifecycle:won')).toBe(true)
  })

  it('same-lifecycle flip is a no-op (transition null, no audit spam)', async () => {
    const created = await estimatingApi.create(toCreatePayload(buildMaintenanceEstimate()))
    const res = await estimatingApi.setLifecycle(created.id, 'bidding')
    expect(res.transition).toBeNull()
    const audit = await estimatingApi.listStatusTransitions(created.id)
    expect(audit).toHaveLength(0)
  })
})
