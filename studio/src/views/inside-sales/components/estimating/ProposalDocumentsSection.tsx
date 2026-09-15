// ---------------------------------------------------------------------------
// ProposalDocumentsSection — the three upload slots in the Generate Proposal
// form (Handoff 47 §4): Contract, Measurements / takeoff map, and Other
// attachments.
//
// Aspire has no API for the contract or the measurement totals, so a rep
// uploads Aspire's *Print Proposal* export here. Documents hang off the estimate
// (intake_attachments, estimate-scoped), so a second proposal from the same
// estimate inherits them with no re-upload. They are appended to the tail of the
// rendered PDF in fixed order: measurements → contract → other.
//
// Cardinality:
//   Contract      — one file, replaceable, PDF only
//   Measurements  — one file, replaceable, PDF or image
//   Other         — many, reorderable, PDF or image
//
// Upload starts on file pick (not on submit) via useAttachmentUpload against
// estimate.id, so the rep sees real progress on multi-megabyte scans. Replacing
// or removing a file soft-deletes the row AND deletes the GCS object. Reordering
// "other" writes sort_order. On reopen the list hydrates from GET .../attachments.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ArrowDown, ArrowUp, FileText, Loader2, Upload, X } from 'lucide-react'
import { estimatingApi } from '@/api/estimating'
import { useDeleteLeadAttachment } from '@/hooks/useProposalDocument'
import { useAttachmentUpload, useLeadAttachmentUpload } from '@/lib/estimating/useAttachmentUpload'
import type { UploadState } from '@/lib/estimating/useAttachmentUpload'
import type { AttachmentKind, IntakeAttachment } from '@/types/estimating'

const PDF_ONLY_ACCEPT = 'application/pdf'
const PDF_OR_IMAGE_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'

// The three proposal-document kinds hydrated and managed here.
const PROPOSAL_KINDS: readonly AttachmentKind[] = [
  'proposal_contract',
  'proposal_measurements',
  'proposal_other',
]

interface ProposalDocumentsSectionProps {
  /** Estimate-scoped uploads (normal path — estimate exists). */
  estimateId?: string | null
  /** Lead-scoped uploads (WS2 — no estimate yet). Used when estimateId is absent. */
  leadId?: string | null
}

// ── Internal upload/delete abstractions (WS2) ─────────────────────────────────
//
// Sub-components receive callbacks rather than raw estimateId/leadId so they
// don't need to know which backend path is used.

type UploadFn = (file: File, kind: AttachmentKind) => Promise<IntakeAttachment | null>
type DeleteFn = (attachment: IntakeAttachment) => Promise<void>

// ── Single-file slot (Contract, Measurements) ─────────────────────────────────

function SingleFileSlot({
  kind,
  label,
  hint,
  accept,
  current,
  uploadFn,
  deleteFn,
  state,
  reset,
  onChanged,
}: {
  kind: AttachmentKind
  label: string
  hint: string
  accept: string
  current: IntakeAttachment | null
  uploadFn: UploadFn
  deleteFn: DeleteFn
  state: UploadState
  reset: () => void
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const uploading = state.status !== 'idle' && state.status !== 'done' && state.status !== 'error'

  async function handlePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same filename
    if (!file) return
    // Replacing: soft-delete the existing one first so we never orphan the object.
    const previous = current
    const attachment = await uploadFn(file, kind)
    if (attachment && previous) {
      await deleteFn(previous).catch(() => {})
    }
    if (attachment) {
      reset()
      onChanged()
    }
  }

  async function handleRemove() {
    if (!current) return
    await deleteFn(current).catch(() => {})
    onChanged()
  }

  return (
    <div data-testid={`proposal-doc-${kind}`}>
      <p className="text-xs font-medium text-[hsl(var(--fg))]">{label}</p>
      <p className="mb-1 text-[10px] text-[hsl(var(--muted-fg))]">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={label}
        onChange={handlePick}
      />
      {current ? (
        <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs">
          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-[#2E7D52]" />
          <span className="flex-1 truncate">{current.fileName}</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-[11px] font-medium text-[#2E7D52] hover:underline"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={handleRemove}
            className="p-0.5 rounded hover:bg-[hsl(var(--muted))] cursor-pointer"
            aria-label={`Remove ${current.fileName}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : uploading ? (
        <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs text-[hsl(var(--muted-fg))]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Uploading… {state.progress}%
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-[hsl(var(--border))] px-2.5 py-1.5 text-xs text-[hsl(var(--muted-fg))] transition-colors hover:border-[#2E7D52] hover:text-[#2E7D52]"
        >
          <Upload className="h-3.5 w-3.5" />
          Attach
        </button>
      )}
      {state.status === 'error' && state.error && (
        <p role="alert" className="mt-1 text-[11px] text-[#c0392b]">
          {state.error}
        </p>
      )}
    </div>
  )
}

// ── Multi-file, reorderable slot (Other) ──────────────────────────────────────

function MultiFileSlot({
  label,
  hint,
  accept,
  items,
  uploadFn,
  deleteFn,
  reorderFn,
  state,
  reset,
  onChanged,
}: {
  label: string
  hint: string
  accept: string
  items: IntakeAttachment[]
  uploadFn: UploadFn
  deleteFn: DeleteFn
  /** Persist a new sort_order for an attachment. Null when reordering is unsupported (lead-scoped). */
  reorderFn: ((attachmentId: string, sortOrder: number) => Promise<void>) | null
  state: UploadState
  reset: () => void
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const uploading = state.status !== 'idle' && state.status !== 'done' && state.status !== 'error'

  async function handlePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const attachment = await uploadFn(file, 'proposal_other')
    if (attachment) {
      // New file goes to the end of the current order.
      if (reorderFn) {
        const nextSort = items.length
          ? Math.max(...items.map((i) => i.sortOrder)) + 1
          : 0
        if (nextSort !== attachment.sortOrder) {
          await reorderFn(attachment.id, nextSort).catch(() => {})
        }
      }
      reset()
      onChanged()
    }
  }

  async function handleRemove(att: IntakeAttachment) {
    await deleteFn(att).catch(() => {})
    onChanged()
  }

  // Reorder two adjacent rows by normalizing every row's sort_order to its new
  // position. Swapping the two values instead is a no-op when rows share a
  // sort_order (e.g. legacy rows all defaulted to 0), which silently breaks the
  // arrows; assigning contiguous indices is collision-proof.
  async function move(index: number, direction: -1 | 1) {
    if (!reorderFn) return
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const reordered = [...items]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(target, 0, moved)
    await Promise.all(
      reordered
        .map((att, i) => ({ att, i }))
        .filter(({ att, i }) => att.sortOrder !== i)
        .map(({ att, i }) => reorderFn(att.id, i)),
    ).catch(() => {})
    onChanged()
  }

  return (
    <div data-testid="proposal-doc-proposal_other">
      <p className="text-xs font-medium text-[hsl(var(--fg))]">{label}</p>
      <p className="mb-1 text-[10px] text-[hsl(var(--muted-fg))]">{hint}</p>
      <div className="flex flex-col gap-1.5">
        {items.map((att, i) => (
          <div
            key={att.id}
            className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs"
          >
            <FileText className="h-3.5 w-3.5 flex-shrink-0 text-[#2E7D52]" />
            <span className="flex-1 truncate">{att.fileName}</span>
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${att.fileName} up`}
              className="p-0.5 rounded hover:bg-[hsl(var(--muted))] disabled:opacity-30"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              aria-label={`Move ${att.fileName} down`}
              className="p-0.5 rounded hover:bg-[hsl(var(--muted))] disabled:opacity-30"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => handleRemove(att)}
              className="p-0.5 rounded hover:bg-[hsl(var(--muted))] cursor-pointer"
              aria-label={`Remove ${att.fileName}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={label}
        onChange={handlePick}
      />
      {uploading ? (
        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs text-[hsl(var(--muted-fg))]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Uploading… {state.progress}%
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1.5 flex items-center gap-1.5 rounded-md border border-dashed border-[hsl(var(--border))] px-2.5 py-1.5 text-xs text-[hsl(var(--muted-fg))] transition-colors hover:border-[#2E7D52] hover:text-[#2E7D52]"
        >
          <Upload className="h-3.5 w-3.5" />
          Add attachment
        </button>
      )}
      {state.status === 'error' && state.error && (
        <p role="alert" className="mt-1 text-[11px] text-[#c0392b]">
          {state.error}
        </p>
      )}
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────
//
// WS2: accepts either estimateId (normal path) or leadId (no-estimate path).
// When estimateId is present it uses estimate-scoped endpoints. When only
// leadId is present it uses lead-scoped endpoints (presign/confirm/list).

function EstimateScopedSection({
  estimateId,
}: {
  estimateId: string
}) {
  const [attachments, setAttachments] = useState<IntakeAttachment[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  // Each slot gets its own hook instance so validation errors are isolated
  // (WS2 split uploadFn out of the slot, so state+reset must travel with it).
  const contractHook = useAttachmentUpload()
  const measurementsHook = useAttachmentUpload()
  const othersHook = useAttachmentUpload()

  const hydrate = useCallback(() => {
    setFetchError(null)
    estimatingApi
      .listAttachments(estimateId)
      .then((data) =>
        setAttachments(
          data.filter((a) => PROPOSAL_KINDS.includes(a.kind) && a.status !== 'deleted'),
        ),
      )
      .catch(() => {
        setFetchError('Failed to load attachments. Please refresh.')
      })
  }, [estimateId])

  useEffect(() => { hydrate() }, [hydrate])

  const contractUploadFn: UploadFn = useCallback(
    (file, kind) => contractHook.upload(estimateId, file, kind),
    [estimateId, contractHook],
  )
  const measurementsUploadFn: UploadFn = useCallback(
    (file, kind) => measurementsHook.upload(estimateId, file, kind),
    [estimateId, measurementsHook],
  )
  const othersUploadFn: UploadFn = useCallback(
    (file, kind) => othersHook.upload(estimateId, file, kind),
    [estimateId, othersHook],
  )
  const deleteFn: DeleteFn = useCallback(
    (att) => estimatingApi.deleteAttachment(estimateId, att.id),
    [estimateId],
  )
  const reorderFn = useCallback(
    (attachmentId: string, sortOrder: number): Promise<void> =>
      estimatingApi.patchAttachmentSortOrder(estimateId, attachmentId, sortOrder).then(() => undefined),
    [estimateId],
  )

  const contract = attachments.find((a) => a.kind === 'proposal_contract') ?? null
  const measurements = attachments.find((a) => a.kind === 'proposal_measurements') ?? null
  const others = attachments
    .filter((a) => a.kind === 'proposal_other')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))

  return (
    <>
      {fetchError && (
        <p role="alert" className="text-[11px] text-[#c0392b]">
          {fetchError}
        </p>
      )}
      <SingleFileSlot kind="proposal_contract" label="Contract" hint="The Aspire contract pages (PDF only)." accept={PDF_ONLY_ACCEPT} current={contract} uploadFn={contractUploadFn} deleteFn={deleteFn} state={contractHook.state} reset={contractHook.reset} onChanged={hydrate} />
      <SingleFileSlot kind="proposal_measurements" label="Measurements / takeoff map" hint="The measurement-totals page or takeoff map (PDF or image)." accept={PDF_OR_IMAGE_ACCEPT} current={measurements} uploadFn={measurementsUploadFn} deleteFn={deleteFn} state={measurementsHook.state} reset={measurementsHook.reset} onChanged={hydrate} />
      <MultiFileSlot label="Other attachments" hint="Anything else to append — spec sheets, notary documents, enhancement credits (PDF or image). Licenses are not needed here; they already print from branch credentials." accept={PDF_OR_IMAGE_ACCEPT} items={others} uploadFn={othersUploadFn} deleteFn={deleteFn} reorderFn={reorderFn} state={othersHook.state} reset={othersHook.reset} onChanged={hydrate} />
    </>
  )
}

function LeadScopedSection({
  leadId,
}: {
  leadId: string
}) {
  const [attachments, setAttachments] = useState<IntakeAttachment[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  // Each slot gets its own hook instance so validation errors are isolated.
  const contractHook = useLeadAttachmentUpload(leadId)
  const measurementsHook = useLeadAttachmentUpload(leadId)
  const othersHook = useLeadAttachmentUpload(leadId)

  const hydrate = useCallback(() => {
    setFetchError(null)
    estimatingApi
      .listLeadAttachments(leadId)
      .then((data) =>
        setAttachments(
          data.filter((a) => PROPOSAL_KINDS.includes(a.kind) && a.status !== 'deleted'),
        ),
      )
      .catch(() => {
        setFetchError('Failed to load attachments. Please refresh.')
      })
  }, [leadId])

  useEffect(() => { hydrate() }, [hydrate])

  // Lead-scoped attachments have no estimate_id → deleteAttachment uses the
  // lead-scoped list endpoint, but the delete itself targets the row by id.
  // Since there's no lead-scoped delete endpoint yet we soft-delete via the
  // same route (the attachment row is identified by its id, which is globally
  // unique regardless of anchor). Reordering is not supported without an
  // estimate (sort_order writes are estimate-scoped only).
  const contractUploadFn: UploadFn = useCallback((file, kind) => contractHook.upload(file, kind), [contractHook])
  const measurementsUploadFn: UploadFn = useCallback((file, kind) => measurementsHook.upload(file, kind), [measurementsHook])
  const othersUploadFn: UploadFn = useCallback((file, kind) => othersHook.upload(file, kind), [othersHook])
  const { mutateAsync: deleteMutation } = useDeleteLeadAttachment(leadId)
  const deleteFn: DeleteFn = useCallback(
    async (att) => { await deleteMutation(att.id) },
    [deleteMutation],
  )

  const contract = attachments.find((a) => a.kind === 'proposal_contract') ?? null
  const measurements = attachments.find((a) => a.kind === 'proposal_measurements') ?? null
  const others = attachments
    .filter((a) => a.kind === 'proposal_other')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))

  return (
    <>
      {fetchError && (
        <p role="alert" className="text-[11px] text-[#c0392b]">
          {fetchError}
        </p>
      )}
      <SingleFileSlot kind="proposal_contract" label="Contract" hint="The Aspire contract pages (PDF only)." accept={PDF_ONLY_ACCEPT} current={contract} uploadFn={contractUploadFn} deleteFn={deleteFn} state={contractHook.state} reset={contractHook.reset} onChanged={hydrate} />
      <SingleFileSlot kind="proposal_measurements" label="Measurements / takeoff map" hint="The measurement-totals page or takeoff map (PDF or image)." accept={PDF_OR_IMAGE_ACCEPT} current={measurements} uploadFn={measurementsUploadFn} deleteFn={deleteFn} state={measurementsHook.state} reset={measurementsHook.reset} onChanged={hydrate} />
      <MultiFileSlot label="Other attachments" hint="Anything else to append — spec sheets, notary documents, enhancement credits (PDF or image). Licenses are not needed here; they already print from branch credentials." accept={PDF_OR_IMAGE_ACCEPT} items={others} uploadFn={othersUploadFn} deleteFn={deleteFn} reorderFn={null} state={othersHook.state} reset={othersHook.reset} onChanged={hydrate} />
    </>
  )
}

export function ProposalDocumentsSection({ estimateId, leadId }: ProposalDocumentsSectionProps) {
  return (
    <section
      aria-labelledby="proposal-documents-heading"
      data-testid="proposal-documents-section"
      className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
    >
      <h3
        id="proposal-documents-heading"
        className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]"
      >
        Documents
      </h3>
      <p className="mb-3 text-[11px] text-[hsl(var(--muted-fg))]">
        Uploaded from Aspire&apos;s Print Proposal export. These are appended to the end of the
        generated PDF: measurements first, then the contract, then any other attachments.
      </p>
      <div className="flex flex-col gap-4">
        {estimateId ? (
          <EstimateScopedSection estimateId={estimateId} />
        ) : leadId ? (
          <LeadScopedSection leadId={leadId} />
        ) : null}
      </div>
    </section>
  )
}
