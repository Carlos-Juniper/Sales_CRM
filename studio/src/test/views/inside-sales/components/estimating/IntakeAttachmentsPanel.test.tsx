// ---------------------------------------------------------------------------
// IntakeAttachmentsPanel tests
//
// The panel lists intake attachments for an estimate and shows a Download
// button. Stored rows with object_key set are downloadable; legacy rows and
// pending rows render as disabled ("Name only").
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render } from '@/test/utils'
import { server } from '@/mocks/server'
import { IntakeAttachmentsPanel } from '@/views/inside-sales/components/estimating/IntakeAttachmentsPanel'
import type { IntakeAttachment } from '@/types/estimating'

const API = '/api'

function buildAtt(overrides?: Partial<IntakeAttachment>): IntakeAttachment {
  return {
    id: 'att-1',
    intakeSubmissionId: 'ins-1',
    estimateId: null,
    fileName: 'site_plan.pdf',
    contentType: 'application/pdf',
    sizeBytes: 512_000,
    kind: 'property_map',
    uploadedBy: 'u1',
    status: 'stored',
    objectKey: 'estimating/est-1/att-1.pdf',
    downloadable: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('IntakeAttachmentsPanel', () => {
  beforeEach(() => {
    // Default: empty list
    server.use(
      http.get(`${API}/estimating/estimates/:id/attachments`, () =>
        HttpResponse.json([]),
      ),
      http.get(`${API}/estimating/estimates/:estimateId/attachments/:attachmentId/download-url`, () =>
        HttpResponse.json({ url: 'https://gcs.example.com/signed', expiresIn: 600 }),
      ),
    )
  })

  it('renders nothing when there are no attachments', async () => {
    const { container } = render(<IntakeAttachmentsPanel estimateId="est-1" />)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="loading"]')).toBeNull()
    })
    expect(screen.queryByText('Intake Attachments')).toBeNull()
  })

  it('shows attachment file name and kind badge for a stored attachment', async () => {
    server.use(
      http.get(`${API}/estimating/estimates/:id/attachments`, () =>
        HttpResponse.json([buildAtt()]),
      ),
    )

    render(<IntakeAttachmentsPanel estimateId="est-1" />)

    await screen.findByText('site_plan.pdf')
    expect(screen.getByText('Property Map')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download site_plan\.pdf/i })).toBeEnabled()
  })

  it('disables Download button for a legacy row (downloadable=false)', async () => {
    server.use(
      http.get(`${API}/estimating/estimates/:id/attachments`, () =>
        HttpResponse.json([buildAtt({ downloadable: false, objectKey: null, status: 'stored' })]),
      ),
    )

    render(<IntakeAttachmentsPanel estimateId="est-1" />)

    await screen.findByText('site_plan.pdf')
    const btn = screen.getByRole('button', { name: /download site_plan\.pdf/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText('Name only')).toBeInTheDocument()
  })

  it('clicking Download calls getAttachmentDownloadUrl and creates an anchor', async () => {
    const clickSpy = vi.fn()
    const anchorEl = { href: '', download: '', click: clickSpy }
    // Save original before spying to avoid infinite recursion.
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return anchorEl as unknown as HTMLElement
      return origCreateElement(tag)
    })

    server.use(
      http.get(`${API}/estimating/estimates/:id/attachments`, () =>
        HttpResponse.json([buildAtt()]),
      ),
    )

    try {
      const user = userEvent.setup()
      render(<IntakeAttachmentsPanel estimateId="est-1" />)

      const btn = await screen.findByRole('button', { name: /download site_plan\.pdf/i })
      await user.click(btn)

      await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1))
      expect(anchorEl.href).toContain('gcs.example.com')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('shows a PDF, Word, or Excel icon from contentType', async () => {
    server.use(
      http.get(`${API}/estimating/estimates/:id/attachments`, () =>
        HttpResponse.json([
          buildAtt({ id: 'pdf', fileName: 'spec.pdf', contentType: 'application/pdf', kind: 'rfp' }),
          buildAtt({ id: 'doc', fileName: 'scope.doc', contentType: 'application/msword', kind: 'rfp' }),
          buildAtt({
            id: 'docx',
            fileName: 'scope.docx',
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            kind: 'rfp',
          }),
          buildAtt({ id: 'xls', fileName: 'pricing.xls', contentType: 'application/vnd.ms-excel', kind: 'rfp' }),
          buildAtt({
            id: 'xlsx',
            fileName: 'pricing.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            kind: 'rfp',
          }),
        ]),
      ),
    )

    render(<IntakeAttachmentsPanel estimateId="est-1" />)

    await screen.findByText('spec.pdf')
    expect(screen.getByRole('img', { name: 'PDF document' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Word document' })).toHaveLength(2)
    expect(screen.getAllByRole('img', { name: 'Excel workbook' })).toHaveLength(2)
    expect(screen.getByTestId('attachment-icon-pdf')).toBeInTheDocument()
    expect(screen.getAllByTestId('attachment-icon-word')).toHaveLength(2)
    expect(screen.getAllByTestId('attachment-icon-excel')).toHaveLength(2)
  })

  it('downloads an Excel RFP with the original filename', async () => {
    const clickSpy = vi.fn()
    const anchorEl = { href: '', download: '', click: clickSpy }
    const origCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return anchorEl as unknown as HTMLElement
      return origCreateElement(tag)
    })

    server.use(
      http.get(`${API}/estimating/estimates/:id/attachments`, () =>
        HttpResponse.json([
          buildAtt({
            id: 'xlsx',
            fileName: 'pricing.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            kind: 'rfp',
            objectKey: 'estimating/est-1/xlsx.xlsx',
          }),
        ]),
      ),
      http.get(`${API}/estimating/estimates/:estimateId/attachments/:attachmentId/download-url`, () =>
        HttpResponse.json({ url: 'https://gcs.example.com/pricing.xlsx', expiresIn: 600 }),
      ),
    )

    try {
      const user = userEvent.setup()
      render(<IntakeAttachmentsPanel estimateId="est-1" />)
      const btn = await screen.findByRole('button', { name: /download pricing\.xlsx/i })
      await user.click(btn)
      await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1))
      expect(anchorEl.download).toBe('pricing.xlsx')
      expect(anchorEl.href).toContain('pricing.xlsx')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('shows RFP badge for rfp kind', async () => {
    server.use(
      http.get(`${API}/estimating/estimates/:id/attachments`, () =>
        HttpResponse.json([buildAtt({ kind: 'rfp', fileName: 'rfp.pdf', id: 'att-rfp' })]),
      ),
    )

    render(<IntakeAttachmentsPanel estimateId="est-1" />)

    await screen.findByText('rfp.pdf')
    expect(screen.getByText('RFP')).toBeInTheDocument()
  })
})
