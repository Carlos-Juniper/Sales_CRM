import { describe, it, expect } from 'vitest'
import { estimatingApi } from '@/api/estimating'
import { apiClient } from '@/api/client'
import {
  buildMaintenanceEstimate,
  buildInstallEstimate,
  toCreatePayload,
} from '@/mocks/estimatingData'
import type { Estimate } from '@/types/estimating'
import type { CreateEstimatePayload } from '@/api/estimating'

describe('fixture builders', () => {
  it('builds a full maintenance estimate (sections + services, hours engine fields)', () => {
    const est = buildMaintenanceEstimate()
    expect(est.estimateType).toBe('maintenance')
    expect(est.sections.length).toBeGreaterThan(0)
    const services = est.sections.flatMap((s) => s.services)
    expect(services.length).toBeGreaterThan(0)
    for (const s of est.sections) expect(s.squareFeet).toBeGreaterThan(0)
    for (const sv of services) expect(typeof sv.complexityPct).toBe('number')
  })

  it('builds a full install estimate (kit components, embedded cost, target GM)', () => {
    const est = buildInstallEstimate()
    expect(est.estimateType).toBe('install')
    const services = est.sections.flatMap((s) => s.services)
    expect(services.length).toBeGreaterThan(0)
    const withComponents = services.filter((sv) => sv.components.length > 0)
    expect(withComponents.length).toBeGreaterThan(0)
    for (const sv of withComponents) {
      expect(sv.unitSellCents).not.toBeNull()
      expect(sv.embeddedCostCents).not.toBeNull()
      for (const c of sv.components) {
        expect(['labor', 'material']).toContain(c.kind)
        expect(Number.isInteger(c.unitCostCents)).toBe(true)
      }
    }
  })

  it('applies overrides', () => {
    const est = buildMaintenanceEstimate({ name: 'Override Test', branchCity: 'Raleigh' })
    expect(est.name).toBe('Override Test')
    expect(est.branchCity).toBe('Raleigh')
  })
})

describe('estimating data-access layer (MSW round-trip)', () => {
  it('round-trips a full maintenance estimate', async () => {
    const payload = toCreatePayload(buildMaintenanceEstimate({ name: 'RT Maintenance' }))
    const created = await estimatingApi.create(payload)
    expect(created.id).toBeTruthy()
    expect(created.estimateType).toBe('maintenance')

    const fetched = await estimatingApi.get(created.id)
    expect(fetched.name).toBe('RT Maintenance')
    expect(fetched.sections.length).toBe(payload.sections.length)
    expect(fetched.sections.flatMap((s) => s.services).length).toBe(
      payload.sections.flatMap((s) => s.services).length,
    )
  })

  it('round-trips a full install estimate including kit components', async () => {
    const payload = toCreatePayload(buildInstallEstimate({ name: 'RT Install' }))
    const created = await estimatingApi.create(payload)
    expect(created.estimateType).toBe('install')

    const fetched = await estimatingApi.get(created.id)
    const components = fetched.sections.flatMap((s) => s.services).flatMap((sv) => sv.components)
    expect(components.length).toBeGreaterThan(0)
  })

  it('lists estimates filtered by estimateType', async () => {
    await estimatingApi.create(toCreatePayload(buildMaintenanceEstimate({ name: 'List Maint' })))
    await estimatingApi.create(toCreatePayload(buildInstallEstimate({ name: 'List Install' })))
    const installs = await estimatingApi.list({ estimateType: 'install' })
    expect(installs.length).toBeGreaterThan(0)
    expect(installs.every((e: Estimate) => e.estimateType === 'install')).toBe(true)
  })

  it('stores occurrence counts as integers or null and returns them on get and list', async () => {
    const payload = toCreatePayload(buildMaintenanceEstimate({ name: 'Counts' }))
    const created = await estimatingApi.create({
      ...payload,
      mowingOccurrences: 0,
      pruningOccurrences: null,
      turfFertOccurrences: 6,
    })
    expect(created.mowingOccurrences).toBe(0)
    expect(created.pruningOccurrences).toBeNull()
    expect(created.turfFertOccurrences).toBe(6)
    expect(created.shrubFertOccurrences).toBeNull()
    expect(created.ipmOccurrences).toBeNull()
    expect(created.irrigationOccurrences).toBeNull()

    const fetched = await estimatingApi.get(created.id)
    expect(fetched.mowingOccurrences).toBe(0)
    const listed = (await estimatingApi.list()).find((row) => row.id === created.id)
    expect(listed?.irrigationOccurrences).toBeNull()

    const patched = await estimatingApi.update(created.id, { pruningOccurrences: 12 })
    expect(patched.pruningOccurrences).toBe(12)
    expect(patched.mowingOccurrences).toBe(0)

    const cleared = await estimatingApi.update(created.id, { mowingOccurrences: null })
    expect(cleared.mowingOccurrences).toBeNull()
    expect(cleared.pruningOccurrences).toBe(12)
  })

  it('rejects a non-integer occurrence count with the 422 detail and writes nothing', async () => {
    const payload = toCreatePayload(buildMaintenanceEstimate({ name: 'Bad count' }))
    await expect(
      estimatingApi.create({ ...payload, mowingOccurrences: 1.5 }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'mowingOccurrences must be an integer from 0 to 366, or null',
    })
    await expect(
      estimatingApi.create({ ...payload, ipmOccurrences: '4' as unknown as number }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'ipmOccurrences must be an integer from 0 to 366, or null',
    })

    const created = await estimatingApi.create({ ...payload, mowingOccurrences: 10 })
    await expect(
      estimatingApi.update(created.id, { turfFertOccurrences: 367 }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'turfFertOccurrences must be an integer from 0 to 366, or null',
    })
    const unchanged = await estimatingApi.get(created.id)
    expect(unchanged.mowingOccurrences).toBe(10)
    expect(unchanged.turfFertOccurrences).toBeNull()
  })

  it('patches mutable estimate fields', async () => {
    const created = await estimatingApi.create(toCreatePayload(buildMaintenanceEstimate()))
    const updated = await estimatingApi.update(created.id, { status: 'in_progress', name: 'Renamed' })
    expect(updated.status).toBe('in_progress')
    expect(updated.name).toBe('Renamed')
  })

  it('round-trips sections and services', async () => {
    const created = await estimatingApi.create(toCreatePayload(buildMaintenanceEstimate()))
    const newSection = await estimatingApi.createSection(created.id, {
      name: 'Retention Pond',
      squareFeet: 22000,
      sortOrder: 99,
    })
    expect(newSection.id).toBeTruthy()

    const newService = await estimatingApi.createService(created.id, newSection.id, {
      catalogItemId: null,
      label: 'Pond Edge Trimming',
      qty: 26,
      uom: '/yr',
      complexityPct: 0.05,
      unitSellCents: 380,
      embeddedCostCents: null,
      targetGm: null,
      hours: null,
      sortOrder: 0,
      components: [],
    })
    expect(newService.label).toBe('Pond Edge Trimming')

    const patched = await estimatingApi.updateService(created.id, newSection.id, newService.id, { qty: 30 })
    expect(patched.qty).toBe(30)

    const fetched = await estimatingApi.get(created.id)
    const section = fetched.sections.find((s) => s.id === newSection.id)
    expect(section?.services.find((sv) => sv.id === newService.id)?.qty).toBe(30)
  })
})

describe('attachment API round-trip (GCS feature)', () => {
  /** Creates an estimate with an intake payload so the MSW mock has a submission to join on. */
  async function createWithIntake(name: string): Promise<string> {
    const base = buildMaintenanceEstimate({ name })
    const payload: CreateEstimatePayload = {
      ...toCreatePayload(base),
      intake: { payload: { crmLeadNumber: 'L-001', crmRep: 'Alice' } },
    }
    const created = await estimatingApi.create(payload)
    return created.id
  }

  it('presign returns attachmentId + uploadUrl and list shows pending row', async () => {
    const estimateId = await createWithIntake('Presign Test')
    const { attachmentId, uploadUrl } = await estimatingApi.presignAttachment(estimateId, {
      kind: 'property_map',
      fileName: 'site.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
    })
    expect(attachmentId).toBeTruthy()
    expect(uploadUrl).toContain('__mock_gcs_upload')

    const atts = await estimatingApi.listAttachments(estimateId)
    const found = atts.find((a) => a.id === attachmentId)
    expect(found).toBeTruthy()
    expect(found?.status).toBe('pending')
    expect(found?.downloadable).toBe(false)
  })

  it('confirm flips status to stored and downloadable becomes true', async () => {
    const estimateId = await createWithIntake('Confirm Test')
    const { attachmentId } = await estimatingApi.presignAttachment(estimateId, {
      kind: 'rfp',
      fileName: 'rfp.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    })
    const confirmed = await estimatingApi.confirmAttachment(estimateId, attachmentId)
    expect(confirmed.status).toBe('stored')
    expect(confirmed.downloadable).toBe(true)

    // list must reflect the update
    const atts = await estimatingApi.listAttachments(estimateId)
    expect(atts.find((a) => a.id === attachmentId)?.downloadable).toBe(true)
  })

  it('download-url returns url + expiresIn for stored attachment', async () => {
    const estimateId = await createWithIntake('Download URL Test')
    const { attachmentId } = await estimatingApi.presignAttachment(estimateId, {
      kind: 'other',
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4096,
    })
    await estimatingApi.confirmAttachment(estimateId, attachmentId)

    const { url, expiresIn } = await estimatingApi.getAttachmentDownloadUrl(estimateId, attachmentId)
    expect(url).toContain('__mock_gcs_download')
    expect(expiresIn).toBe(600)
  })

  it('download-url returns 409 for pending attachment', async () => {
    const estimateId = await createWithIntake('Pending DL Test')
    const { attachmentId } = await estimatingApi.presignAttachment(estimateId, {
      kind: 'other',
      fileName: 'pending.pdf',
      contentType: 'application/pdf',
      sizeBytes: 512,
    })
    await expect(
      estimatingApi.getAttachmentDownloadUrl(estimateId, attachmentId),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('presign rejects non-PDF with 400', async () => {
    const estimateId = await createWithIntake('Non-PDF Test')
    await expect(
      estimatingApi.presignAttachment(estimateId, {
        kind: 'other',
        fileName: 'sheet.xlsx',
        contentType: 'application/vnd.ms-excel',
        sizeBytes: 1024,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('estimateType immutability guard (§2)', () => {
  it('client update() exposes no estimateType update path and throws if one is smuggled in', async () => {
    const created = await estimatingApi.create(toCreatePayload(buildMaintenanceEstimate()))
    await expect(
      // deliberately bypass the compile-time restriction to prove the runtime guard
      estimatingApi.update(created.id, { estimateType: 'install' } as never),
    ).rejects.toThrow(/immutable/i)
  })

  it('the mock backend rejects an estimateType change with 400', async () => {
    const created = await estimatingApi.create(toCreatePayload(buildInstallEstimate()))
    await expect(
      apiClient.patch(`/estimating/estimates/${created.id}`, { estimateType: 'maintenance' }),
    ).rejects.toMatchObject({ status: 400 })
    // and the stored record is untouched
    const fetched = await estimatingApi.get(created.id)
    expect(fetched.estimateType).toBe('install')
  })
})
