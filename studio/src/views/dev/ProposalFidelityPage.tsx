// ---------------------------------------------------------------------------
// ProposalFidelityPage — DEV-only visual-fidelity diff for the proposal
// generator. Mounted at /dev/proposal-fidelity (router.tsx gates the route on
// import.meta.env.DEV, so neither this file nor devFixtures reaches a prod bundle).
//
// What it replaces: hand-copying JSX into a scratch HTML file and screenshotting
// with Playwright to eyeball against a separately-rendered reference PNG. Here
// the REAL <ProposalPreview> renders from fixture data — no backend, no DB, no
// auth — with the matching Coral Bay reference page laid over each sheet at 1:1.
// Edit studio/src/styles/proposal-print.css, and Vite HMR shows the result
// against the reference immediately.
//
// The 1:1 overlay is only possible because a .print-page is a fixed 8.5x11in =
// 816x1056px and scripts/rasterize_coral_bay_reference.py emits PNGs at exactly
// that size. No scaling math anywhere — if the two ever diverge, fix the
// rasterizer, not this file.
//
// Two 401s are expected in the console here and are not this route's bug:
// AuthBootstrap's /api/auth/me (every page boot makes it) and ProposalPreview's
// own ProposalDocumentSummaryPanel attachments fetch, which is .catch()-swallowed
// by design and renders nothing. Neither touches a .print-page. api/client.ts
// exempts /dev/* from its 401 → /login hard redirect so they stay harmless.
//
// Page pairing is deliberately dumb: our page N gets reference page N. Our page
// order does not match Coral Bay's (different optional sections, different
// chapter order), so the pairing is a starting point that the human re-pairs by
// eye. A "smart" matcher would be more code and less predictable.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PROPOSAL_CONFIG_KEY } from '@/hooks/useProposals'
import { makeDevProposalFixture, DEV_ASPIRE_BRANCH_ID } from '@/lib/proposal/devFixtures'
import { ProposalPreview } from '@/views/inside-sales/components/estimating/ProposalPreview'
import '@/styles/proposal-print.css'

/** Pages rasterized from business docs/Coral Bay HOA.pdf. */
const REFERENCE_PAGE_COUNT = 41

function referenceUrl(pageNumber: number): string {
  return `/proposal/reference/coral-bay-p${String(pageNumber).padStart(2, '0')}.png`
}

/**
 * A QueryClient pre-seeded with everything ProposalPreview fetches internally,
 * so the component's own hooks resolve from cache and nothing hits the network.
 *
 * Nested inside App's provider: the inner provider wins for this subtree only.
 * `retry: false` + infinite staleTime means a key we somehow missed fails once
 * and stays quiet rather than retrying in a loop.
 */
function makeSeededQueryClient(fixture: ReturnType<typeof makeDevProposalFixture>) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })
  client.setQueryData([PROPOSAL_CONFIG_KEY], fixture.config)
  client.setQueryData(
    ['proposals', 'config', 'licenses', DEV_ASPIRE_BRANCH_ID],
    fixture.licenses,
  )
  client.setQueryData(
    ['proposals', 'config', 'insurance', DEV_ASPIRE_BRANCH_ID],
    fixture.insurance,
  )
  return client
}

export default function ProposalFidelityPage() {
  const fixture = useMemo(() => makeDevProposalFixture(), [])
  const queryClient = useMemo(() => makeSeededQueryClient(fixture), [fixture])

  const [showOverlays, setShowOverlays] = useState(true)
  const [opacity, setOpacity] = useState(50)
  const [offset, setOffset] = useState(0)
  const [pageEls, setPageEls] = useState<HTMLElement[]>([])

  // Callback ref rather than useEffect+useRef: it fires once the document
  // subtree is in the DOM, which is exactly when the .print-page nodes exist.
  const collectPages = useCallback((root: HTMLDivElement | null) => {
    setPageEls(root ? Array.from(root.querySelectorAll<HTMLElement>('.print-page')) : [])
  }, [])

  // Neutral backdrop so the white sheets read as paper — same trick
  // ProposalPreviewRoute uses.
  useEffect(() => {
    const previous = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#3f3f46'
    return () => {
      document.body.style.backgroundColor = previous
    }
  }, [])

  // `o` toggles overlays. Ignored while typing so the slider's number input
  // (and any future text field) keeps working.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.key === 'o' || e.key === 'O') setShowOverlays((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="min-h-screen bg-[#3f3f46]">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-black/30 bg-[#18181b] px-4 py-2.5 text-xs text-white/90">
        <span className="font-semibold">Proposal fidelity — Coral Bay overlay</span>

        <button
          type="button"
          onClick={() => setShowOverlays((v) => !v)}
          data-testid="toggle-overlays"
          className="rounded-md bg-white/10 px-3 py-1.5 font-medium hover:bg-white/20"
        >
          {showOverlays ? 'Hide overlays' : 'Show overlays'} <span className="opacity-50">(o)</span>
        </button>

        <label className="flex items-center gap-2">
          Opacity
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            aria-label="Reference overlay opacity"
            className="w-44 accent-[#f47320]"
          />
          <span className="w-9 tabular-nums">{opacity}%</span>
        </label>

        {/* Our page order diverges from the reference's, so a global shift is
            usually all it takes to line a run of pages back up. */}
        <label className="flex items-center gap-2">
          Ref offset
          <input
            type="number"
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value) || 0)}
            aria-label="Reference page offset"
            className="w-16 rounded border border-white/20 bg-white/10 px-1.5 py-1 tabular-nums"
          />
        </label>

        <span className="opacity-60">
          {pageEls.length} rendered / {REFERENCE_PAGE_COUNT} reference pages
        </span>
      </div>

      <div className="flex justify-center py-8">
        {/* .proposal-viewer gives the inter-sheet gap. No zoom: the overlay is
            1:1 in CSS px and keeping the scale at 100% removes any doubt about
            whether a mismatch is real or a rounding artefact. */}
        <div className="proposal-viewer" ref={collectPages}>
          <QueryClientProvider client={queryClient}>
            <ProposalPreview
              formState={fixture.formState}
              lead={fixture.lead}
              estimate={fixture.estimate}
              onBack={() => {}}
              proposalId={null}
              chapterOrder={null}
              allTeamMembers={fixture.allTeamMembers}
              teamMembers={fixture.teamMembers}
              executiveTeamMembers={fixture.executiveTeamMembers}
              clientReferences={fixture.clientReferences}
              portfolioProperties={fixture.portfolioProperties}
              signer={fixture.signer}
              showActionBar={false}
            />
          </QueryClientProvider>
        </div>
      </div>

      {showOverlays &&
        pageEls.map((el, i) => {
          const refPage = i + 1 + offset
          if (refPage < 1 || refPage > REFERENCE_PAGE_COUNT) return null
          // .print-page is position:relative with overflow:hidden, so an
          // inset-0 child lands exactly on the sheet and is clipped to it.
          return createPortal(
            <img
              key={refPage}
              src={referenceUrl(refPage)}
              alt={`Coral Bay reference page ${refPage}`}
              data-testid={`reference-overlay-${i + 1}`}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                zIndex: 999,
                opacity: opacity / 100,
                pointerEvents: 'none',
              }}
            />,
            el,
            `overlay-${i}`,
          )
        })}
    </div>
  )
}
