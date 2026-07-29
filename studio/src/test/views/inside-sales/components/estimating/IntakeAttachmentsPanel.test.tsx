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
