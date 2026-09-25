/**
 * useAttachmentUpload — orchestrates the three-step GCS intake attachment upload:
 *   1. presign  → backend mints a pending row and returns a resumable session URI
 *   2. PUT      → browser streams bytes directly to GCS (XMLHttpRequest for progress)
 *   3. confirm  → backend verifies the blob landed and flips status to 'stored'
 *
 * XMLHttpRequest is required over fetch because the Fetch API has no upload-progress
 * event; XHR exposes `upload.onprogress`.
 */
import { useRef, useState, useCallback } from 'react'
import { estimatingApi } from '@/api/estimating'
import type { AttachmentKind, IntakeAttachment } from '@/types/estimating'
import {
  RFP_DOCUMENTS_REJECTED,
  resolveRfpContentType,
  validateAttachmentSize,
} from '@/lib/estimating/rfpContentTypes'

// Per-kind content-type allowlist (mirrors the backend presign validation).
// RFP documents accept PDF, Word, and Excel (see rfpContentTypes). Every other
// intake kind and the proposal contract stay PDF-only. The takeoff scan and
// the proposal measurements/other kinds also accept common image types.
const SCAN_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

// Kinds that accept images as well as PDF (mirrors _IMAGE_OR_PDF_KINDS backend).
const IMAGE_OR_PDF_KINDS: readonly AttachmentKind[] = [
  'takeoff_scan',
  'proposal_measurements',
  'proposal_other',
]

export type UploadStatus = 'idle' | 'presigning' | 'uploading' | 'confirming' | 'done' | 'error'

export interface UploadState {
  status: UploadStatus
  /** 0–100 while uploading; 100 once confirmed. */
  progress: number
  error: string | null
  attachment: IntakeAttachment | null
}

export interface UseAttachmentUpload {
  upload: (estimateId: string, file: File, kind: AttachmentKind) => Promise<IntakeAttachment | null>
  state: UploadState
  reset: () => void
  /**
   * Error from the most recent `upload` call, readable as soon as the promise
   * resolves. Mirrors `state.error` without waiting for a re-render.
   */
  lastUploadError: () => string | null
}

const INITIAL: UploadState = {
  status: 'idle',
  progress: 0,
  error: null,
  attachment: null,
}

interface ResolvedUpload {
  contentType: string
}

function clientValidate(file: File, kind: AttachmentKind): ResolvedUpload | { error: string } {
  if (kind === 'rfp') {
    const contentType = resolveRfpContentType(file)
    if (!contentType) return { error: RFP_DOCUMENTS_REJECTED }
    const sizeError = validateAttachmentSize(file.size)
    if (sizeError) return { error: sizeError }
    return { contentType }
  }

  if (IMAGE_OR_PDF_KINDS.includes(kind)) {
    if (!SCAN_CONTENT_TYPES.includes(file.type)) {
      return { error: 'This file must be a PNG, JPEG, WebP, or PDF' }
    }
  } else if (file.type !== 'application/pdf') {
    return { error: 'Only PDF files are supported' }
  }

  const sizeError = validateAttachmentSize(file.size)
  if (sizeError) return { error: sizeError }
  return { contentType: file.type }
}

function xhrPut(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    // The resumable session was opened with the presign response's contentType.
    // Sending file.type instead fails confirm with "Upload validation failed"
    // whenever the browser left file.type empty or mismatched.
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`GCS upload failed: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Upload failed'
}

export function useAttachmentUpload(): UseAttachmentUpload {
  const [state, setState] = useState<UploadState>(INITIAL)
  const lastUploadErrorRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    lastUploadErrorRef.current = null
    setState(INITIAL)
  }, [])

  const fail = useCallback((message: string): null => {
    lastUploadErrorRef.current = message
    setState({ ...INITIAL, status: 'error', error: message })
    return null
  }, [])

  const upload = useCallback(
    async (estimateId: string, file: File, kind: AttachmentKind): Promise<IntakeAttachment | null> => {
      lastUploadErrorRef.current = null
      const resolved = clientValidate(file, kind)
      if ('error' in resolved) return fail(resolved.error)

      try {
        setState({ ...INITIAL, status: 'presigning' })

        const presign = await estimatingApi.presignAttachment(estimateId, {
          kind,
          fileName: file.name,
          contentType: resolved.contentType,
          sizeBytes: file.size,
        })

        setState((prev) => ({ ...prev, status: 'uploading' }))

        // Prefer the MIME the session was opened with. Fall back only when an
        // older response omits contentType (the bytes we presigned with).
        await xhrPut(presign.uploadUrl, file, presign.contentType || resolved.contentType, (pct) =>
          setState((prev) => ({ ...prev, progress: pct })),
        )

        setState((prev) => ({ ...prev, status: 'confirming', progress: 100 }))

        const attachment = await estimatingApi.confirmAttachment(estimateId, presign.attachmentId)

        lastUploadErrorRef.current = null
        setState({ status: 'done', progress: 100, error: null, attachment })
        return attachment
      } catch (err) {
        return fail(errorMessage(err))
      }
    },
    [fail],
  )

  const lastUploadError = useCallback(() => lastUploadErrorRef.current, [])

  return { upload, state, reset, lastUploadError }
}

// ── Lead-scoped variant (WS2: estimate-optional proposals) ────────────────────
//
// Identical upload orchestration to useAttachmentUpload but targets the
// lead-scoped presign / confirm endpoints (/api/leads/{leadId}/attachments/...).
// Used by ProposalDocumentsSection when no estimate is present yet.

export interface UseLeadAttachmentUpload {
  upload: (file: File, kind: AttachmentKind) => Promise<IntakeAttachment | null>
  state: UploadState
  reset: () => void
  /** See {@link UseAttachmentUpload.lastUploadError}. */
  lastUploadError: () => string | null
}

export function useLeadAttachmentUpload(leadId: string): UseLeadAttachmentUpload {
  const [state, setState] = useState<UploadState>(INITIAL)
  const lastUploadErrorRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    lastUploadErrorRef.current = null
    setState(INITIAL)
  }, [])

  const fail = useCallback((message: string): null => {
    lastUploadErrorRef.current = message
    setState({ ...INITIAL, status: 'error', error: message })
    return null
  }, [])

  const upload = useCallback(
    async (file: File, kind: AttachmentKind): Promise<IntakeAttachment | null> => {
      lastUploadErrorRef.current = null
      const resolved = clientValidate(file, kind)
      if ('error' in resolved) return fail(resolved.error)

      try {
        setState({ ...INITIAL, status: 'presigning' })

        const presign = await estimatingApi.presignLeadAttachment(leadId, {
          kind,
          fileName: file.name,
          contentType: resolved.contentType,
          sizeBytes: file.size,
        })

        setState((prev) => ({ ...prev, status: 'uploading' }))

        await xhrPut(presign.uploadUrl, file, presign.contentType || resolved.contentType, (pct) =>
          setState((prev) => ({ ...prev, progress: pct })),
        )

        setState((prev) => ({ ...prev, status: 'confirming', progress: 100 }))

        const attachment = await estimatingApi.confirmLeadAttachment(leadId, presign.attachmentId)

        lastUploadErrorRef.current = null
        setState({ status: 'done', progress: 100, error: null, attachment })
        return attachment
      } catch (err) {
        return fail(errorMessage(err))
      }
    },
    [leadId, fail],
  )

  const lastUploadError = useCallback(() => lastUploadErrorRef.current, [])

  return { upload, state, reset, lastUploadError }
}
