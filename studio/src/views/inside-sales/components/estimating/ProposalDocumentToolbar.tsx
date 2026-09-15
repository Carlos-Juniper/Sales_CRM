// ---------------------------------------------------------------------------
// ProposalDocumentToolbar — the chrome around a rendered proposal document.
//
// Shared by the two surfaces that show a proposal to a human:
//   • ProposalPreview's own bar (inline preview inside the builder)
//   • ProposalPreviewRoute's sticky bar (full-screen, adds zoom controls)
//
// Always .no-print, and never rendered at all on /proposals/:id/print — the
// headless capture should see the document and nothing else.
// ---------------------------------------------------------------------------

import { ArrowLeft, Printer, FileDown, Loader2 } from 'lucide-react'
import { useRenderProposal } from '@/hooks/useProposals'

export interface ProposalDocumentToolbarProps {
  /** Null before the proposal is saved — both PDF actions need a persisted id. */
  proposalId: string | null
  onBack?: () => void
  /** Defaults to the builder's wording; the full-screen route overrides it. */
  backLabel?: string
  /** Zoom controls (or anything else) to sit between Back and the PDF actions. */
  children?: React.ReactNode
  className?: string
}

export function ProposalDocumentToolbar({
  proposalId,
  onBack,
  backLabel = 'Back to form',
  children,
  className = '',
}: ProposalDocumentToolbarProps) {
  const renderMutation = useRenderProposal()

  return (
    <div
      className={`no-print flex items-center justify-between gap-4 ${className}`}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </button>
      ) : (
        <span />
      )}

      {children}

      <div className="flex items-center gap-2">
        {/* Server-side Chromium render, persisted to GCS and versioned. */}
        <button
          type="button"
          data-testid="generate-pdf-btn"
          disabled={renderMutation.isPending || !proposalId}
          onClick={() => {
            if (!proposalId) return
            renderMutation.mutate(proposalId, {
              onSuccess: (result) => {
                if (result.downloadUrl) {
                  window.open(result.downloadUrl, '_blank')
                }
              },
            })
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2E7D52] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {renderMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileDown className="h-3.5 w-3.5" />
          )}
          {renderMutation.isPending ? 'Generating…' : 'Generate PDF'}
        </button>

        {/* Print fallback — opens the chrome-free print route in a new tab.
            Printing the in-app preview directly fights AppShell's fixed-height,
            clipped layout and the visibility lift-out, which takes
            #proposal-preview out of flow so Chrome paginates from the viewport
            height rather than the content height. The print route is the exact
            DOM the server renders, so what you see matches the PDF. */}
        <button
          type="button"
          onClick={() => {
            if (proposalId) {
              window.open(`/proposals/${proposalId}/print?autoprint=1`, '_blank')
              return
            }
            window.print()
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-xs font-medium text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
        >
          <Printer className="h-3.5 w-3.5" />
          Print
        </button>
      </div>
    </div>
  )
}
