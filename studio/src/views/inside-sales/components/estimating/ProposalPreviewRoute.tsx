// ---------------------------------------------------------------------------
// ProposalPreviewRoute — full-screen proposal document viewer.
//
// Mounted at /proposals/:id/preview, OUTSIDE AppShell (see router.tsx) for the
// same reason the print route is: a .print-page is a fixed 8.5in — 816px at
// 96dpi — and any ancestor narrower than that clips it rather than scaling it.
// The builder previously rendered this inline inside LeadDetailPanel, whose
// sm:max-w-2xl (672px) minus BidTab's px-6 left 624px of usable width, so the
// right ~24% of every page — the second column, the stats block, the footer
// page number — was silently cut off.
//
// Zoom uses the CSS `zoom` property rather than `transform: scale()` on
// purpose. `zoom` scales used values, so the scroll container measures the
// document at its displayed size; `transform` leaves the layout box at full
// size and strands a screenful of dead space below the last page. Nothing here
// touches the print route, so PDF geometry is unaffected either way.
// ---------------------------------------------------------------------------

import React, { useEffect, useLayoutEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, ZoomIn, ZoomOut, Maximize2, AlertTriangle, ListOrdered } from 'lucide-react'
import { useProposalDocument } from '@/hooks/useProposalDocument'
import { useProposalOverflow } from '@/hooks/useProposalOverflow'
import { naturalBodyChapterKeys, resolveChapterOrder } from '@/lib/proposal/chapters'
import { ProposalPreview } from './ProposalPreview'
import { ProposalDocumentToolbar } from './ProposalDocumentToolbar'
import { ChapterReorderPanel } from './ChapterReorderPanel'
import '@/styles/proposal-print.css'

/** A .print-page is 8.5in wide; at CSS 96dpi that is 816px. */
const PAGE_WIDTH_PX = 816
/** Breathing room either side of the sheet so it does not touch the chrome. */
const VIEWPORT_PADDING_PX = 64

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5] as const
const MIN_ZOOM = ZOOM_STEPS[0]
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

/**
 * Largest zoom that fits a full sheet across the viewport, capped at 1.
 *
 * The cap matters: on a 1920px display an uncapped fit would be 2.2x, which
 * renders a proposal larger than the paper it prints on.
 */
function fitToWidthZoom(viewportWidth: number): number {
  const usable = Math.max(viewportWidth - VIEWPORT_PADDING_PX, 320)
  return Math.min(usable / PAGE_WIDTH_PX, 1)
}

export default function ProposalPreviewRoute(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const doc = useProposalDocument(id ?? null)

  const [arranging, setArranging] = useState(false)

  // null = "follow the viewport"; a number = the user picked a zoom explicitly
  // and it should survive a window resize.
  const [zoom, setZoom] = useState<number | null>(null)
  const [fitZoom, setFitZoom] = useState(() =>
    fitToWidthZoom(typeof window === 'undefined' ? 1280 : window.innerWidth),
  )

  // Layout effect so the first paint is already at the right scale — a frame at
  // 100% followed by a snap to 62% reads as a rendering glitch.
  useLayoutEffect(() => {
    const recompute = () => setFitZoom(fitToWidthZoom(window.innerWidth))
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [])

  // The document sets its own page background; a neutral backdrop is what makes
  // the white sheets read as paper. Set on <body> so overscroll matches too.
  useEffect(() => {
    const previous = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#3f3f46'
    return () => {
      document.body.style.backgroundColor = previous
    }
  }, [])

  const effectiveZoom = zoom ?? fitZoom

  // Re-measured on zoom change: `zoom` scales used values, so scrollHeight and
  // clientHeight both move and the px delta has to be read again.
  const overflowing = useProposalOverflow({
    ready: doc.ready,
    annotate: true,
    deps: [effectiveZoom],
  })

  // Snap to the next preset above/below the current zoom. The epsilon keeps a
  // fit value that lands exactly on a preset from being a no-op click.
  function step(direction: 1 | -1) {
    if (direction === 1) {
      const up = ZOOM_STEPS.find((z) => z > effectiveZoom + 0.001)
      setZoom(up ?? MAX_ZOOM)
    } else {
      const down = [...ZOOM_STEPS].reverse().find((z) => z < effectiveZoom - 0.001)
      setZoom(down ?? MIN_ZOOM)
    }
  }

  if (doc.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#3f3f46]">
        <Loader2 className="h-6 w-6 animate-spin text-white/70" />
      </div>
    )
  }

  // W4: doc.estimate is optional — estimate-less proposals are valid.
  if (doc.notFound || !doc.ready || !doc.formState || !doc.lead) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#3f3f46] px-6 text-center">
        <p className="text-sm text-white/80">
          This proposal could not be loaded. It may have been deleted, or you may
          not have access to it.
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
        >
          Go back
        </button>
      </div>
    )
  }

  // Same reconciliation ProposalPreview.tsx runs internally for rendering —
  // computed here too so the reorder panel's drag list matches what's actually
  // on the page, without either one depending on the other's JSX.
  const photographedProperties = doc.portfolioProperties.filter(
    (p) => p.photoObjectKeys.length > 0,
  )
  const naturalChapterKeys = naturalBodyChapterKeys({
    sections: new Set(doc.formState.sections),
    hasOrgChart: doc.formState.orgChart.included,
    hasExecutiveTeam: doc.executiveTeamMembers.length > 0,
    hasPortfolio: photographedProperties.length > 0,
    hasContract:
      doc.estimate != null &&
      doc.estimate.estimateType === 'maintenance' &&
      (doc.estimate.status === 'approved' || doc.estimate.lifecycle === 'won'),
  })
  const orderedChapterKeys = resolveChapterOrder(naturalChapterKeys, doc.chapterOrder)

  return (
    <div className="min-h-screen bg-[#3f3f46]">
      {/* Sticky chrome. ProposalPreview's own bar is suppressed below so the
          Back / zoom / PDF actions stay together in one place. */}
      <div className="sticky top-0 z-10 border-b border-black/20 bg-[hsl(var(--bg))] px-4 py-2.5 shadow-sm">
        <ProposalDocumentToolbar
          proposalId={id ?? null}
          onBack={() => navigate(-1)}
          backLabel="Back"
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setArranging(true)}
              data-testid="arrange-pages-btn"
              className="mr-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-[hsl(var(--muted-fg))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]"
            >
              <ListOrdered className="h-3.5 w-3.5" />
              Arrange pages
            </button>
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={effectiveZoom <= MIN_ZOOM + 0.001}
              aria-label="Zoom out"
              className="rounded-md p-1.5 text-[hsl(var(--muted-fg))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--fg))] disabled:opacity-40"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span
              className="w-11 text-center text-xs font-medium tabular-nums text-[hsl(var(--fg))]"
              data-testid="zoom-level"
            >
              {Math.round(effectiveZoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={effectiveZoom >= MAX_ZOOM - 0.001}
              aria-label="Zoom in"
              className="rounded-md p-1.5 text-[hsl(var(--muted-fg))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--fg))] disabled:opacity-40"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(null)}
              aria-label="Fit to width"
              title="Fit to width"
              className="ml-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-[hsl(var(--muted-fg))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Fit
            </button>
          </div>
        </ProposalDocumentToolbar>

        {/* Named, not just counted: "page 19" sends a rep hunting, "Meet Our
            Team" tells them which pick to trim. */}
        {overflowing.length > 0 && (
          <div
            role="alert"
            data-testid="overflow-warning"
            className="mt-2 flex items-start gap-2 rounded-md bg-[#c0392b]/10 px-3 py-2 text-xs text-[#c0392b]"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              <strong>
                Content is clipped on {overflowing.length}{' '}
                {overflowing.length === 1 ? 'page' : 'pages'}.
              </strong>{' '}
              A page is a fixed 8.5 × 11in, so anything past the bottom is cut
              from the PDF. Affected:{' '}
              {overflowing
                .map((p) => `p${p.page}${p.testId ? ` (${p.testId.replace(/^page-/, '')})` : ''}`)
                .join(', ')}
              . Trim the copy or reduce the picks on those pages.
            </span>
          </div>
        )}
      </div>

      {/* `zoom` on the wrapper, never on .print-page itself — the page geometry
          tokens are what the PDF depends on and must stay untouched. */}
      <div className="flex justify-center py-8">
        <div className="proposal-viewer" style={{ zoom: effectiveZoom }}>
          <ProposalPreview
            formState={doc.formState}
            lead={doc.lead}
            estimate={doc.estimate}
            onBack={() => navigate(-1)}
            proposalId={id ?? null}
            chapterOrder={doc.chapterOrder}
            allTeamMembers={doc.allTeamMembers}
            teamMembers={doc.teamMembers}
            executiveTeamMembers={doc.executiveTeamMembers}
            clientReferences={doc.clientReferences}
            portfolioProperties={doc.portfolioProperties}
            signer={doc.signer}
            showActionBar={false}
          />
        </div>
      </div>

      {arranging && id && (
        <ChapterReorderPanel
          proposalId={id}
          chapterKeys={orderedChapterKeys}
          onClose={() => setArranging(false)}
        />
      )}
    </div>
  )
}
