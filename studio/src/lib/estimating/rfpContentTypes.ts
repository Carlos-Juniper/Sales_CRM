// ---------------------------------------------------------------------------
// RFP document types for the maintenance and install intakes.
//
// One table drives the file-input `accept` attribute, client-side checks, and
// the MIME sent to presign. It matches the backend pairs: extension and MIME
// are compared case-insensitively, and the value we store is the canonical
// MIME below. Every other attachment kind stays on its own allowlist.
// ---------------------------------------------------------------------------

export const RFP_CONTENT_TYPES = [
  { extension: '.pdf', contentType: 'application/pdf', family: 'pdf' },
  { extension: '.doc', contentType: 'application/msword', family: 'word' },
  {
    extension: '.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    family: 'word',
  },
  { extension: '.xls', contentType: 'application/vnd.ms-excel', family: 'excel' },
  {
    extension: '.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    family: 'excel',
  },
] as const satisfies readonly {
  readonly extension: `.${string}`
  readonly contentType: string
  readonly family: 'pdf' | 'word' | 'excel'
}[]

export type RfpContentTypeEntry = (typeof RFP_CONTENT_TYPES)[number]
export type RfpExtension = RfpContentTypeEntry['extension']
export type RfpContentType = RfpContentTypeEntry['contentType']
export type RfpDocumentFamily = RfpContentTypeEntry['family']

/** Backend wording for an RFP whose extension is not PDF, Word, or Excel. */
export const RFP_DOCUMENTS_REJECTED =
  'RFP documents must be PDF, Word (.doc, .docx), or Excel (.xls, .xlsx)'

/** Backend wording when the extension and MIME disagree. */
export const RFP_EXTENSION_MISMATCH = 'RFP file extension does not match its content type'

/** 2 GiB — mirrors GCS_MAX_UPLOAD_BYTES. Inclusive upper bound. */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024

/** `<input accept>` derived from the table (extensions and MIME types). */
export const RFP_FILE_ACCEPT = RFP_CONTENT_TYPES.map(
  (row) => `${row.extension},${row.contentType}`,
).join(',')

const BY_EXTENSION = new Map<string, RfpContentTypeEntry>(
  RFP_CONTENT_TYPES.map((row) => [row.extension, row]),
)

const BY_CONTENT_TYPE = new Map<string, RfpContentTypeEntry>(
  RFP_CONTENT_TYPES.map((row) => [row.contentType, row]),
)

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** Strip MIME parameters and case so `Application/PDF; charset=utf-8` matches. */
export function normalizeContentType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase()
}

/**
 * Extension including the dot, lowercased. A leading-dot name (`.docx`) has
 * no extension — same rule as Python's `os.path.splitext`.
 */
export function fileExtension(fileName: string): string {
  const trimmed = fileName.trim()
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

export function rfpEntryForFileName(fileName: string): RfpContentTypeEntry | null {
  return BY_EXTENSION.get(fileExtension(fileName)) ?? null
}

/**
 * Canonical MIME to send on presign for an RFP file.
 *
 * Browsers often leave `file.type` empty for `.doc` and `.xls`, or set a type
 * that does not match the extension. When the type is missing or disagrees
 * with the table, the extension wins. Returns null when the extension is not
 * an allowed RFP document.
 */
export function resolveRfpContentType(file: { name: string; type: string }): RfpContentType | null {
  const entry = rfpEntryForFileName(file.name)
  if (!entry) return null
  return entry.contentType
}

/**
 * Same check the presign endpoint runs: extension in the table and MIME
 * agrees (parameters ignored, case-insensitive). Returns the canonical MIME.
 */
export function validateRfpDocument(
  fileName: string,
  contentType: string,
): { ok: true; contentType: RfpContentType } | { ok: false; detail: string } {
  const entry = rfpEntryForFileName(fileName)
  if (!entry) return { ok: false, detail: RFP_DOCUMENTS_REJECTED }
  if (normalizeContentType(contentType) !== entry.contentType) {
    return { ok: false, detail: RFP_EXTENSION_MISMATCH }
  }
  return { ok: true, contentType: entry.contentType }
}

/** `sizeBytes` must be a positive integer up to 2 GiB. Returns the backend message. */
export function validateAttachmentSize(sizeBytes: number): string | null {
  if (!Number.isInteger(sizeBytes)) return 'sizeBytes must be an integer'
  if (sizeBytes <= 0) return 'sizeBytes must be positive'
  if (sizeBytes > MAX_ATTACHMENT_BYTES) return 'File exceeds the 2 GiB limit'
  return null
}

/** PDF, Word, or Excel from a stored `contentType`. Null for images and unknown types. */
export function rfpFamilyForContentType(contentType: string): RfpDocumentFamily | null {
  return BY_CONTENT_TYPE.get(normalizeContentType(contentType))?.family ?? null
}

/** Object-key extension from a validated content type. Never taken from the raw filename. */
export function extensionForStoredContentType(contentType: string): string {
  const mime = normalizeContentType(contentType)
  const rfp = BY_CONTENT_TYPE.get(mime)
  if (rfp) return rfp.extension.slice(1)
  return IMAGE_EXTENSIONS[mime] ?? 'bin'
}
