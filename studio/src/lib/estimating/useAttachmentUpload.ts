/**
 * useAttachmentUpload — orchestrates the three-step GCS intake attachment upload:
 *   1. presign  → backend mints a pending row and returns a resumable session URI
 *   2. PUT      → browser streams bytes directly to GCS (XMLHttpRequest for progress)
 *   3. confirm  → backend verifies the blob landed and flips status to 'stored'
 *
 * XMLHttpRequest is required over fetch because the Fetch API has no upload-progress
 * event; XHR exposes `upload.onprogress`.
 */
import { useState, useCallback } from 'react'
import { estimatingApi } from '@/api/estimating'
import type { AttachmentKind, IntakeAttachment } from '@/types/estimating'

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB — mirrors GCS_MAX_UPLOAD_BYTES

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
}

const INITIAL: UploadState = {
  status: 'idle',
  progress: 0,
  error: null,
  attachment: null,
}

function clientValidate(file: File): string | null {
  if (file.type !== 'application/pdf') return 'Only PDF files are supported'
  if (file.size > MAX_FILE_BYTES) return 'File exceeds the 2 GiB limit'
  return null
}

function xhrPut(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', 'application/pdf')
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

export function useAttachmentUpload(): UseAttachmentUpload {
  const [state, setState] = useState<UploadState>(INITIAL)

  const reset = useCallback(() => setState(INITIAL), [])

  const upload = useCallback(
    async (estimateId: string, file: File, kind: AttachmentKind): Promise<IntakeAttachment | null> => {
      const validationError = clientValidate(file)
      if (validationError) {
        setState({ ...INITIAL, status: 'error', error: validationError })
        return null
      }

      try {
        setState({ ...INITIAL, status: 'presigning' })

        const { attachmentId, uploadUrl } = await estimatingApi.presignAttachment(estimateId, {
          kind,
          fileName: file.name,
          contentType: 'application/pdf',
          sizeBytes: file.size,
        })

        setState((prev) => ({ ...prev, status: 'uploading' }))

        await xhrPut(uploadUrl, file, (pct) =>
          setState((prev) => ({ ...prev, progress: pct })),
        )

        setState((prev) => ({ ...prev, status: 'confirming', progress: 100 }))

        const attachment = await estimatingApi.confirmAttachment(estimateId, attachmentId)

        setState({ status: 'done', progress: 100, error: null, attachment })
        return attachment
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed'
        setState({ ...INITIAL, status: 'error', error: message })
        return null
      }
    },
    [],
  )

  return { upload, state, reset }
}
