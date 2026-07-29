// ---------------------------------------------------------------------------
// IntakeAttachmentsPanel — lists intake attachments for an estimate and
// provides a Download button for stored files.
//
// Rendered inside both MaintenanceEditor and InstallEditor so the estimator
// has one-click access to site plans, RFPs, and other uploaded PDFs.
//
// Rows with downloadable===false (legacy name-only rows, or pending uploads)
// render disabled — the filename is visible but Download is greyed out.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { estimatingApi } from '@/api/estimating'
import type { IntakeAttachment, AttachmentKind } from '@/types/estimating'

interface IntakeAttachmentsPanelProps {
  estimateId: string
}

const KIND_LABEL: Record<AttachmentKind, string> = {
  property_map: 'Property Map',
  rfp: 'RFP',
  other: 'Other',
}

export function IntakeAttachmentsPanel({ estimateId }: IntakeAttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<IntakeAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    estimatingApi
      .listAttachments(estimateId)
      .then((data) => { if (!cancelled) setAttachments(data) })
      .catch(() => { /* non-fatal — panel stays empty */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [estimateId])

  async function handleDownload(att: IntakeAttachment) {
    if (!att.downloadable || downloading) return
    setDownloading(att.id)
    try {
      const { url } = await estimatingApi.getAttachmentDownloadUrl(estimateId, att.id)
      // Hidden anchor pattern mirrors TakeoffInsert.tsx:118-123.
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = att.fileName
      anchor.click()
    } catch {
      // silently ignore — user can retry
    } finally {
      setDownloading(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading attachments…
      </div>
    )
  }

  if (attachments.length === 0) return null

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Intake Attachments
      </p>
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{att.fileName}</span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {KIND_LABEL[att.kind] ?? att.kind}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!att.downloadable || downloading === att.id}
            onClick={() => handleDownload(att)}
            aria-label={`Download ${att.fileName}`}
          >
            {downloading === att.id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            <span className="ml-1">{att.downloadable ? 'Download' : 'Name only'}</span>
          </Button>
        </div>
      ))}
    </div>
  )
}
