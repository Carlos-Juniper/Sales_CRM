import { useState } from 'react'
import { useProposalMediaUrl } from '@/hooks/useProposals'

// ---------------------------------------------------------------------------
// ImageUploadField — the one place a human puts an image into the system.
//
// Handoff 43 §2. Before this, `headshotObjectKey` and `photoObjectKeys` were
// writable only by typing a GCS object key into a text box, so every proposal
// rendered initials where a face belongs and dropped its Portfolio page for
// want of a single photo.
//
// The upload is a multipart POST to the API, which validates the real bytes and
// derives the object key from the row id — the same path the license/scan
// endpoint uses. There is no client-supplied key and no signed PUT: see the
// note above _read_validated_image in api/settings.py for why.
//
// The mutation is owned by the caller so each surface invalidates its own list
// query; this component only renders the current image, the picker, and the
// pending/error state.
// ---------------------------------------------------------------------------

/** Mirrors api.attachments.IMAGE_CONTENT_TYPES — the server is authoritative. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** Mirrors api.attachments.GCS_MAX_IMAGE_BYTES (15 MiB default). */
const MAX_BYTES = 15 * 1024 * 1024

export interface ImageUploadFieldProps {
  /** Label above the control. */
  label: string
  /** Stable id for the file input, so the label is clickable. */
  id: string
  /** The stored GCS key, or null when nothing has been uploaded. */
  objectKey: string | null
  /**
   * Called with the picked file once it passes the client-side checks. Omit to
   * hide the picker entirely — an already-uploaded photo in an ordered list is
   * removed and re-added, not replaced in place.
   */
  onUpload?: (file: File) => void
  /** Omit to hide the remove button (e.g. while a required image is missing). */
  onRemove?: () => void
  /** True while the caller's mutation is in flight. */
  isPending?: boolean
  /** Alt text for the preview — a real description, not "image". */
  alt: string
  /** Aspect-ratio hint for the preview box. Headshots are 3:4 in the document. */
  aspect?: 'portrait' | 'landscape'
  /** Extra guidance under the control (crop expectations, etc.). */
  hint?: string
}

export function ImageUploadField({
  label,
  id,
  objectKey,
  onUpload,
  onRemove,
  isPending = false,
  alt,
  aspect = 'landscape',
  hint,
}: ImageUploadFieldProps) {
  const { data: media } = useProposalMediaUrl(objectKey)
  const [error, setError] = useState<string | null>(null)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset immediately so re-picking the same file after a failure still fires
    // a change event.
    e.target.value = ''
    if (!file) return

    // These two checks are duplicated on the server, which is the one that
    // counts. They are here so a 20 MB photo fails instantly instead of after
    // a full upload.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Images must be JPEG, PNG, or WebP.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`Image exceeds the ${MAX_BYTES / (1024 * 1024)} MiB limit.`)
      return
    }
    setError(null)
    onUpload?.(file)
  }

  const previewClass =
    aspect === 'portrait'
      ? 'h-20 w-[3.75rem] object-cover'
      : 'h-16 w-24 object-cover'

  return (
    <div>
      {onUpload ? (
        <label
          htmlFor={id}
          className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5"
        >
          {label}
        </label>
      ) : (
        <span className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">
          {label}
        </span>
      )}
      <div className="flex items-center gap-2">
        {objectKey && media?.url ? (
          <img
            src={media.url}
            alt={alt}
            className={`${previewClass} rounded border border-[var(--border)]`}
          />
        ) : (
          <div
            aria-hidden="true"
            className={`${previewClass} rounded border border-dashed border-[var(--border)]`}
          />
        )}
        <div className="flex flex-col gap-1">
          {onUpload && (
            <input
              id={id}
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              onChange={onPick}
              disabled={isPending}
              className="text-[10px] file:mr-2 file:rounded-md file:border file:border-[var(--border)] file:bg-transparent file:px-2 file:py-1 file:text-[10px] file:text-[var(--fg)]"
            />
          )}
          {objectKey && onRemove && (
            <button
              type="button"
              onClick={() => {
                setError(null)
                onRemove()
              }}
              disabled={isPending}
              className="self-start text-red-600 opacity-70 hover:opacity-100 text-[10px] disabled:opacity-30"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {isPending && (
        <p className="mt-1 text-[10px] text-[var(--fg)] opacity-60">Uploading…</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-[10px] text-red-600">
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="mt-1 text-[10px] text-[var(--fg)] opacity-50">{hint}</p>
      )}
    </div>
  )
}
