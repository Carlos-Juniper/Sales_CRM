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
    ).rejects.toMatchObject({ status: 400, message: 'Only PDF attachments are supported' })
  })

  it('presign accepts an rfp docx and confirm stores that content type after a matching PUT', async () => {
    const estimateId = await createWithIntake('RFP docx')
    const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const presign = await estimatingApi.presignAttachment(estimateId, {
      kind: 'rfp',
      fileName: 'scope.docx',
      contentType,
      sizeBytes: 2048,
    })
    expect(presign.contentType).toBe(contentType)
    expect(presign.objectKey).toMatch(/\.docx$/)

    const put = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': presign.contentType },
      body: new Uint8Array(32),
    })
    expect(put.ok).toBe(true)

    const confirmed = await estimatingApi.confirmAttachment(estimateId, presign.attachmentId)
    expect(confirmed.status).toBe('stored')
    expect(confirmed.contentType).toBe(contentType)

    const download = await estimatingApi.getAttachmentDownloadUrl(estimateId, presign.attachmentId)
    expect(download.url).toContain(presign.objectKey)
    expect(download.expiresIn).toBe(600)
  })

  it('confirm returns 400 when the uploaded blob content type does not match the presign', async () => {
    const estimateId = await createWithIntake('RFP mismatch confirm')
    const presign = await estimatingApi.presignAttachment(estimateId, {
      kind: 'rfp',
      fileName: 'pricing.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1024,
    })
    await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array(16),
    })
    await expect(estimatingApi.confirmAttachment(estimateId, presign.attachmentId)).rejects.toMatchObject({
      status: 400,
      message: 'Upload validation failed',
    })
  })

  it('presign rejects an rfp extension that is not PDF, Word, or Excel', async () => {
    const estimateId = await createWithIntake('RFP exe')
    await expect(
      estimatingApi.presignAttachment(estimateId, {
        kind: 'rfp',
        fileName: 'payload.exe',
        contentType: 'application/pdf',
        sizeBytes: 128,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'RFP documents must be PDF, Word (.doc, .docx), or Excel (.xls, .xlsx)',
    })
  })

  it('presign rejects an rfp whose extension does not match its content type', async () => {
    const estimateId = await createWithIntake('RFP mismatch')
    await expect(
      estimatingApi.presignAttachment(estimateId, {
        kind: 'rfp',
        fileName: 'scope.docx',
        contentType: 'application/pdf',
        sizeBytes: 128,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'RFP file extension does not match its content type',
    })
  })

  it('presign still rejects a docx for a non-rfp kind', async () => {
    const estimateId = await createWithIntake('Property map docx')
    await expect(
      estimatingApi.presignAttachment(estimateId, {
        kind: 'property_map',
        fileName: 'notes.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 128,
      }),
    ).rejects.toMatchObject({ status: 400, message: 'Only PDF attachments are supported' })
  })
})

describe('contract-structure budgets (MSW contract)', () => {
  function payloadWithoutBudgets(name: string) {
    const payload = toCreatePayload(buildMaintenanceEstimate({ name }))
    delete payload.homesBudget
    delete payload.commonAreaBudget
    return payload
  }

  it('stores null when both budgets are omitted', async () => {
    const created = await estimatingApi.create(payloadWithoutBudgets('Omitted budgets'))
    expect(created.homesBudget).toBeNull()
    expect(created.commonAreaBudget).toBeNull()
    const fetched = await estimatingApi.get(created.id)
    expect(fetched.homesBudget).toBeNull()
    expect(fetched.commonAreaBudget).toBeNull()
    const listed = await estimatingApi.list()
    const row = listed.find((e) => e.id === created.id)
    expect(row?.homesBudget).toBeNull()
    expect(row?.commonAreaBudget).toBeNull()
  })

  it('stores null for blank strings and 0 for a typed zero', async () => {
    const created = await estimatingApi.create({
      ...payloadWithoutBudgets('Blank and zero'),
      intake: { payload: { homesBudget: '   ', commonAreaBudget: '0' } },
    })
    expect(created.homesBudget).toBeNull()
    expect(created.commonAreaBudget).toBe(0)
    const [submission] = await estimatingApi.listIntake(created.id)
    expect(submission.payload.homesBudget).toBeNull()
    expect(submission.payload.commonAreaBudget).toBe(0)
  })

  it('stores typed dollar amounts and lets a top-level value win', async () => {
    const created = await estimatingApi.create({
      ...payloadWithoutBudgets('Top-level wins'),
      homesBudget: 120000,
      commonAreaBudget: 10.005,
      intake: { payload: { homesBudget: 1, commonAreaBudget: '' } },
    })
    expect(created.homesBudget).toBe(120000)
    expect(created.commonAreaBudget).toBe(10.01)
    const [submission] = await estimatingApi.listIntake(created.id)
    expect(submission.payload.homesBudget).toBe(120000)
    expect(submission.payload.commonAreaBudget).toBe(10.01)
  })

  it('returns 400 and inserts nothing for a negative or non-numeric budget', async () => {
    await expect(
      estimatingApi.create({ ...payloadWithoutBudgets('Negative budget'), homesBudget: -1 }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      estimatingApi.create({
        ...payloadWithoutBudgets('Non-numeric budget'),
        commonAreaBudget: 'abc' as unknown as number,
      }),
    ).rejects.toMatchObject({ status: 400 })
    const listed = await estimatingApi.list()
    expect(listed.some((e) => e.name === 'Negative budget' || e.name === 'Non-numeric budget')).toBe(false)
  })

  it('PATCH clears with null, keeps an omitted field, stores 0, and 400s on a negative', async () => {
    const created = await estimatingApi.create({
      ...payloadWithoutBudgets('Patch budgets'),
      homesBudget: 500,
      commonAreaBudget: 80,
    })
    const cleared = await estimatingApi.update(created.id, { homesBudget: null })
    expect(cleared.homesBudget).toBeNull()
    expect(cleared.commonAreaBudget).toBe(80)
    const zeroed = await estimatingApi.update(created.id, { commonAreaBudget: 0 })
    expect(zeroed.homesBudget).toBeNull()
    expect(zeroed.commonAreaBudget).toBe(0)
    await expect(
      estimatingApi.update(created.id, { homesBudget: -2 }),
    ).rejects.toMatchObject({ status: 400 })
    const fetched = await estimatingApi.get(created.id)
    expect(fetched.homesBudget).toBeNull()
    expect(fetched.commonAreaBudget).toBe(0)
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
