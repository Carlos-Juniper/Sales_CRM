// ---------------------------------------------------------------------------
// ProposalPrintRoute — bare shell for headless PDF rendering.
//
// Rendered at /proposals/:id/print (no auth guard — the API endpoints gate
// access via session cookie or render-scoped token). No nav, no toolbar, no
// Back button: the headless capture must see the document and nothing else.
//
// Readiness gate: sets window.__PROPOSAL_READY__ = true once every brand face
// and every <img> inside #proposal-preview has resolved. api/proposal_render.py
// polls that flag before calling page.pdf().
//
// Data loading and the ProposalRequest → ProposalFormState mapping live in
// useProposalDocument, shared with ProposalPreviewRoute so the document a rep
// approves on screen and the document Chromium captures cannot diverge.
// ---------------------------------------------------------------------------

import React, { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useProposalDocument } from '@/hooks/useProposalDocument'
import { measureProposalOverflow, waitForLayout } from '@/hooks/useProposalOverflow'
import { BRAND_FACES } from '@/lib/proposal/fonts'
import { preloadProposalBackgrounds, applyProposalAssetCssVars } from '@/lib/proposal/assets'
import { ProposalPreview } from './ProposalPreview'

export default function ProposalPrintRoute(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  // ?autoprint=1 is set by the in-app Print button. The headless renderer never
  // sets it — it polls __PROPOSAL_READY__ and calls page.pdf() instead.
  const autoPrint = searchParams.get('autoprint') === '1'

  // Mark <body> so print-specific global CSS can target this route.
  useEffect(() => {
    document.body.dataset.printRoute = 'true'
    return () => {
      delete document.body.dataset.printRoute
    }
  }, [])

  const doc = useProposalDocument(id ?? null)
  const dataReady = doc.ready

  // Readiness gate
  useEffect(() => {
    if (!dataReady) return
    let cancelled = false

    const settle = async () => {
      // The effect runs after commit, but wait one frame so layout has settled
      // and #proposal-preview's images are attached before we enumerate them.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const root = document.querySelector('#proposal-preview')
      if (!root) return

      // document.fonts.ready only resolves *pending* loads — it says nothing
      // about whether a face was ever requested. Force each brand face to load,
      // then assert it resolved. If any is missing we leave the flag false so
      // the render 503s and the proposal is marked failed, rather than shipping
      // a client-facing PDF set in Arial.
      await Promise.all(
        BRAND_FACES.map((f) => document.fonts.load(f).catch(() => [])),
      )
      await document.fonts.ready
      const missing = BRAND_FACES.filter((f) => !document.fonts.check(f))
      if (missing.length > 0) {
        console.error('[proposal] brand fonts failed to load:', missing)
        return
      }

      const imgs = Array.from(root.querySelectorAll('img'))
      await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)))

      // CSS background-image fetches are invisible to both of the awaits above,
      // so the watermark needs its own preload or the capture can beat it.
      // Apply the CSS custom properties first so the browser starts fetching the
      // correct URLs before preloadProposalBackgrounds() awaits them.
      applyProposalAssetCssVars()
      await preloadProposalBackgrounds()
      if (cancelled) return

      // Measure BEFORE flipping ready, and never annotate: this DOM is what
      // page.pdf() captures, so a QA warning band would land in the customer's
      // document. proposal_render.py reads __PROPOSAL_OVERFLOW__ right after the
      // ready flag, so publishing it first is what makes that read reliable.
      await waitForLayout()
      if (cancelled) return
      const overflowing = measureProposalOverflow(false)
      if (overflowing.length > 0) {
        console.warn(
          '[proposal] content clipped on %d page(s):',
          overflowing.length,
          overflowing,
        )
      }

      ;(window as unknown as { __PROPOSAL_READY__?: boolean }).__PROPOSAL_READY__ = true

      if (autoPrint) {
        // rAF so the browser has committed a paint before the modal print
        // dialog freezes rendering.
        requestAnimationFrame(() => window.print())
      }
    }

    void settle()
    return () => {
      cancelled = true
    }
  }, [dataReady, autoPrint])

  // W4: doc.estimate is optional — estimate-less proposals are valid.
  // Removing !doc.estimate prevents wait_for_function from timing out (which
  // caused the render route to 503) when no approved estimate exists.
  if (!doc.ready || !doc.formState || !doc.lead) {
    return <div style={{ display: 'none' }} />
  }

  return (
    <ProposalPreview
      formState={doc.formState}
      lead={doc.lead}
      estimate={doc.estimate}
      onBack={() => undefined}
      chapterOrder={doc.chapterOrder}
      allTeamMembers={doc.allTeamMembers}
      teamMembers={doc.teamMembers}
      executiveTeamMembers={doc.executiveTeamMembers}
      clientReferences={doc.clientReferences}
      portfolioProperties={doc.portfolioProperties}
      signer={doc.signer}
      showActionBar={false}
    />
  )
}
