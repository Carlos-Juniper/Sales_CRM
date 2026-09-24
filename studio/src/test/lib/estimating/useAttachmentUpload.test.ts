// ---------------------------------------------------------------------------
// useAttachmentUpload hook tests
//
// The hook orchestrates three async steps: presign → XHR PUT → confirm.
// MSW intercepts all three HTTP calls so no real GCS is needed.
//
// XHR is not implemented in jsdom; we stub window.XMLHttpRequest to simulate
// both successful and failing uploads.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { estimatingApi } from '@/api/estimating'
import { server } from '@/mocks/server'
import { useAttachmentUpload } from '@/lib/estimating/useAttachmentUpload'

// ── XHR stub ─────────────────────────────────────────────────────────────────

interface StubXhrOptions {
  /** HTTP status the upload endpoint returns (default 200). */
  status?: number
  /** If true, fires onerror instead of onload. */
  networkError?: boolean
}

const xhrHeaders: Array<Record<string, string>> = []

function stubXhr({ status = 200, networkError = false }: StubXhrOptions = {}) {
  // Must use a regular function/class so `new XMLHttpRequest()` works correctly.
  function MockXHR(this: {
    open: () => void
    setRequestHeader: (name: string, value: string) => void
    send: (body: unknown) => void
    upload: { onprogress: ((e: ProgressEvent) => void) | null }
    onload: (() => void) | null
    onerror: (() => void) | null
    status: number
  }) {
    const headers: Record<string, string> = {}
    xhrHeaders.push(headers)
    this.open = vi.fn()
    this.setRequestHeader = vi.fn((name: string, value: string) => {
      headers[name] = value
    })
    this.upload = { onprogress: null }
    this.onload = null
    this.onerror = null
    this.status = status

    this.send = (_body: unknown) => {
      Promise.resolve().then(() => {
        if (networkError) {
          this.onerror?.()
        } else {
          this.upload.onprogress?.({
            loaded: 100,
            total: 100,
            lengthComputable: true,
          } as ProgressEvent)
          this.onload?.()
        }
      })
    }
  }

  vi.stubGlobal('XMLHttpRequest', MockXHR)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createEstimateWithIntake(): Promise<string> {
  const created = await estimatingApi.create({
    estimateType: 'maintenance',
    name: 'Upload Hook Test',
    aspireNumber: null,
    propertyId: null,
    clientName: 'Test Client',
    aspireBranchId: null,
    branchCity: 'Phoenix-Desert',
    customerType: 'commercial',
    acreage: null,
    contractValueCents: 0,
    targetMargin: 0.22,
    status: 'new_from_sales',
    lifecycle: 'bidding',
    aspireOwner: 'estimating',
    priority: 'medium',
    winProbability: 0.5,
    siteWalkDate: null,
    dueBackDate: new Date().toISOString(),
    anticipatedCloseDate: null,
    serviceStartDate: null,
    assignedLsEstimator: null,
    assignedIrrEstimator: null,
    crmRep: null,
    intake: { payload: { crmLeadNumber: 'L-001' } },
    sections: [],
  })
  return created.id
}

function makePdf(sizeBytes = 1024): File {
  return new File([new Uint8Array(sizeBytes)], 'site.pdf', { type: 'application/pdf' })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('useAttachmentUpload', () => {
  beforeEach(() => {
    xhrHeaders.length = 0
    stubXhr()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts in idle state', () => {
    const { result } = renderHook(() => useAttachmentUpload())
    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.progress).toBe(0)
    expect(result.current.state.error).toBeNull()
  })

  it('completes successfully and returns the confirmed attachment', async () => {
    const estimateId = await createEstimateWithIntake()
    const { result } = renderHook(() => useAttachmentUpload())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let attachment: any = null
    await act(async () => {
      attachment = await result.current.upload(estimateId, makePdf(), 'property_map')
    })

    expect(result.current.state.status).toBe('done')
    expect(result.current.state.progress).toBe(100)
    expect(result.current.state.error).toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(attachment?.status).toBe('stored')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(attachment?.downloadable).toBe(true)
  })

  it('rejects non-PDF files before hitting the network', async () => {
    const estimateId = await createEstimateWithIntake()
    const notPdf = new File([new Uint8Array(512)], 'sheet.xlsx', {
      type: 'application/vnd.ms-excel',
    })
    const { result } = renderHook(() => useAttachmentUpload())

    let ret: Awaited<ReturnType<typeof result.current.upload>> = null
    await act(async () => {
      ret = await result.current.upload(estimateId, notPdf, 'other')
    })

    expect(ret).toBeNull()
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toMatch(/pdf/i)
  })

  it('rejects files over 2 GiB', async () => {
    const estimateId = await createEstimateWithIntake()
    const oversizeFile = new File([], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversizeFile, 'size', { value: 3 * 1024 * 1024 * 1024 })

    const { result } = renderHook(() => useAttachmentUpload())
    await act(async () => {
      await result.current.upload(estimateId, oversizeFile, 'other')
    })

    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toMatch(/2 GiB/i)
  })

  it('sets error state on XHR network failure', async () => {
    vi.unstubAllGlobals()
    stubXhr({ networkError: true })

    const estimateId = await createEstimateWithIntake()
    const { result } = renderHook(() => useAttachmentUpload())

    await act(async () => {
      await result.current.upload(estimateId, makePdf(), 'rfp')
    })

    expect(result.current.state.status).toBe('error')
  })

  // ── takeoff_scan kind (scanned map images, estimate-scoped) ──

  it('uploads a PNG takeoff scan and returns the estimate-scoped attachment', async () => {
    const estimateId = await createEstimateWithIntake()
    const png = new File([new Uint8Array(2048)], 'boundary.png', { type: 'image/png' })
    const { result } = renderHook(() => useAttachmentUpload())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let attachment: any = null
    await act(async () => {
      attachment = await result.current.upload(estimateId, png, 'takeoff_scan')
    })

    expect(result.current.state.status).toBe('done')
    expect(attachment?.kind).toBe('takeoff_scan')
    expect(attachment?.status).toBe('stored')
    expect(attachment?.contentType).toBe('image/png')
    expect(attachment?.objectKey).toMatch(/\.png$/)
  })

  it('still rejects image files for intake kinds (PDF-only)', async () => {
    const estimateId = await createEstimateWithIntake()
    const png = new File([new Uint8Array(512)], 'map.png', { type: 'image/png' })
    const { result } = renderHook(() => useAttachmentUpload())

    let ret: Awaited<ReturnType<typeof result.current.upload>> = null
    await act(async () => {
      ret = await result.current.upload(estimateId, png, 'property_map')
    })

    expect(ret).toBeNull()
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toMatch(/pdf/i)
  })

  it('rejects unsupported types for takeoff_scan before hitting the network', async () => {
    const estimateId = await createEstimateWithIntake()
    const txt = new File([new Uint8Array(64)], 'notes.txt', { type: 'text/plain' })
    const { result } = renderHook(() => useAttachmentUpload())

    let ret: Awaited<ReturnType<typeof result.current.upload>> = null
    await act(async () => {
      ret = await result.current.upload(estimateId, txt, 'takeoff_scan')
    })

    expect(ret).toBeNull()
    expect(result.current.state.status).toBe('error')
  })

  it('uploads an rfp .docx and an rfp .xlsx', async () => {
    const estimateId = await createEstimateWithIntake()
    const { result } = renderHook(() => useAttachmentUpload())

    const docx = new File([new Uint8Array(256)], 'scope.docx', { type: DOCX_MIME })
    const xlsx = new File([new Uint8Array(256)], 'pricing.xlsx', { type: XLSX_MIME })

    let docxAttachment: Awaited<ReturnType<typeof result.current.upload>> = null
    let xlsxAttachment: Awaited<ReturnType<typeof result.current.upload>> = null
    await act(async () => {
      docxAttachment = await result.current.upload(estimateId, docx, 'rfp')
      xlsxAttachment = await result.current.upload(estimateId, xlsx, 'rfp')
    })

    expect(docxAttachment?.status).toBe('stored')
    expect(docxAttachment?.contentType).toBe(DOCX_MIME)
    expect(docxAttachment?.objectKey).toMatch(/\.docx$/)
    expect(xlsxAttachment?.status).toBe('stored')
    expect(xlsxAttachment?.contentType).toBe(XLSX_MIME)
    expect(xlsxAttachment?.objectKey).toMatch(/\.xlsx$/)
  })

  it('derives the MIME for an rfp .doc with an empty file.type and PUTs the presign contentType', async () => {
    const estimateId = await createEstimateWithIntake()
    const file = new File([new Uint8Array(128)], 'scope.doc', { type: '' })
    expect(file.type).toBe('')

    const presignSpy = vi.spyOn(estimatingApi, 'presignAttachment')
    const { result } = renderHook(() => useAttachmentUpload())

    await act(async () => {
      await result.current.upload(estimateId, file, 'rfp')
    })

    expect(presignSpy).toHaveBeenCalledWith(
      estimateId,
      expect.objectContaining({
        kind: 'rfp',
        fileName: 'scope.doc',
        contentType: 'application/msword',
        sizeBytes: 128,
      }),
    )
    const presign = await presignSpy.mock.results[0]?.value
    expect(presign.contentType).toBe('application/msword')
    expect(xhrHeaders.at(-1)?.['Content-Type']).toBe(presign.contentType)
    expect(file.type).toBe('')
    presignSpy.mockRestore()
  })

  it('PUTs the presign response contentType rather than file.type', async () => {
    const estimateId = await createEstimateWithIntake()
    server.use(
      http.post('/api/estimating/estimates/:estimateId/attachments/presign', () =>
        HttpResponse.json(
          {
            attachmentId: 'att-put',
            objectKey: 'estimating/x/att-put.doc',
            uploadUrl: 'http://localhost/__mock_gcs_upload/sess-put',
            contentType: 'application/msword',
          },
          { status: 201 },
        ),
      ),
      http.post('/api/estimating/estimates/:estimateId/attachments/:attachmentId/confirm', () =>
        HttpResponse.json({
          id: 'att-put',
          status: 'stored',
          downloadable: true,
          contentType: 'application/msword',
          kind: 'rfp',
          fileName: 'scope.docx',
        }),
      ),
    )

    // file.type is the docx MIME; the presign response canonicalizes to msword.
    const file = new File([new Uint8Array(32)], 'scope.docx', { type: DOCX_MIME })
    const { result } = renderHook(() => useAttachmentUpload())
    await act(async () => {
      await result.current.upload(estimateId, file, 'rfp')
    })

    expect(xhrHeaders.at(-1)?.['Content-Type']).toBe('application/msword')
    expect(xhrHeaders.at(-1)?.['Content-Type']).not.toBe(file.type)
  })

  it('derives the MIME when an rfp .xls file.type does not match the extension', async () => {
    const estimateId = await createEstimateWithIntake()
    const file = new File([new Uint8Array(64)], 'pricing.XLS', { type: 'application/octet-stream' })
    const presignSpy = vi.spyOn(estimatingApi, 'presignAttachment')
    const { result } = renderHook(() => useAttachmentUpload())

    await act(async () => {
      await result.current.upload(estimateId, file, 'rfp')
    })

    expect(presignSpy).toHaveBeenCalledWith(
      estimateId,
      expect.objectContaining({
        kind: 'rfp',
        fileName: 'pricing.XLS',
        contentType: 'application/vnd.ms-excel',
      }),
    )
    presignSpy.mockRestore()
  })

  it('rejects a .docx for a non-rfp kind before hitting the network', async () => {
    const estimateId = await createEstimateWithIntake()
    const docx = new File([new Uint8Array(64)], 'notes.docx', { type: DOCX_MIME })
    const presignSpy = vi.spyOn(estimatingApi, 'presignAttachment')
    const { result } = renderHook(() => useAttachmentUpload())

    let ret: Awaited<ReturnType<typeof result.current.upload>> = null
    await act(async () => {
      ret = await result.current.upload(estimateId, docx, 'property_map')
    })

    expect(ret).toBeNull()
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toBe('Only PDF files are supported')
    expect(presignSpy).not.toHaveBeenCalled()
    presignSpy.mockRestore()
  })

  it('rejects a disallowed rfp extension with the backend wording', async () => {
    const estimateId = await createEstimateWithIntake()
    const exe = new File([new Uint8Array(32)], 'payload.exe', { type: 'application/pdf' })
    const { result } = renderHook(() => useAttachmentUpload())

    await act(async () => {
      await result.current.upload(estimateId, exe, 'rfp')
    })

    expect(result.current.state.error).toBe(
      'RFP documents must be PDF, Word (.doc, .docx), or Excel (.xls, .xlsx)',
    )
  })

  it('shows the API detail when presign returns 400', async () => {
    server.use(
      http.post('/api/estimating/estimates/:estimateId/attachments/presign', () =>
        HttpResponse.json(
          { detail: 'RFP file extension does not match its content type' },
          { status: 400 },
        ),
      ),
    )

    const estimateId = await createEstimateWithIntake()
    const file = new File([new Uint8Array(64)], 'scope.pdf', { type: 'application/pdf' })
    const { result } = renderHook(() => useAttachmentUpload())

    await act(async () => {
      await result.current.upload(estimateId, file, 'rfp')
    })

    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toBe('RFP file extension does not match its content type')
  })

  it('rejects a non-positive rfp size before presign', async () => {
    const estimateId = await createEstimateWithIntake()
    const empty = new File([], 'empty.pdf', { type: 'application/pdf' })
    const { result } = renderHook(() => useAttachmentUpload())

    await act(async () => {
      await result.current.upload(estimateId, empty, 'rfp')
    })

    expect(result.current.state.error).toBe('sizeBytes must be positive')
  })

  it('reset() brings state back to idle', async () => {
    const estimateId = await createEstimateWithIntake()
    const { result } = renderHook(() => useAttachmentUpload())

    await act(async () => {
      await result.current.upload(estimateId, makePdf(), 'property_map')
    })
    expect(result.current.state.status).toBe('done')

    act(() => { result.current.reset() })
    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.progress).toBe(0)
  })
})
