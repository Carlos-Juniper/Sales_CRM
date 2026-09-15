// ---------------------------------------------------------------------------
// useProposalOverflow — detect content that does not fit on its page.
//
// .print-page is a fixed 8.5 x 11in with overflow:hidden (see
// styles/proposal-print.css). That is deliberate — the on-screen preview is
// meant to BE the PDF — but it means content past the bottom of .well is
// silently dropped from the rendered document. With variable-length inputs (a
// long team bio, six client references, a portfolio property with five photos)
// a page can quietly lose its last paragraph and nobody finds out unless a
// human eyeballs all 24 sheets.
//
// This measures each .well's content against its content box after layout has
// settled, publishes the result on window.__PROPOSAL_OVERFLOW__ so the headless
// renderer can record it next to __PROPOSAL_READY__, and optionally annotates
// the offending pages for a screen-only warning band.
//
// Note the sheet clip is not the only way content disappears. The well reserves
// ~61px of bottom padding for the opaque footer bar, so a page can "fit" the
// sheet (scrollHeight <= clientHeight) yet still have its last line occluded
// behind that bar. We therefore measure against the content box — clientHeight
// minus the vertical padding — not the padding box, so this class of overflow
// is caught rather than silently printing under the footer.
//
// It reports; it does not reflow. Deciding what to drop from an overfull page
// is an editorial call, not something to automate behind a rep's back.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'

/** Sub-pixel rounding in Chromium's layout means exact equality is not usable. */
const TOLERANCE_PX = 2

export interface OverflowingPage {
  /** 1-based position in the document, matching the printed page number. */
  page: number
  /** The page's data-testid, when it has one — names the section in a warning. */
  testId: string | null
  /** How many CSS px of content did not fit. */
  overflowPx: number
}

/**
 * Measure every page and publish the result on window.__PROPOSAL_OVERFLOW__.
 *
 * Exported as a plain function, not just a hook, because the print route has to
 * call it from *inside* its readiness gate — synchronously before it flips
 * __PROPOSAL_READY__. A separate effect would race: proposal_render.py polls the
 * ready flag and could capture, and read the overflow flag, before a
 * hook-scheduled measurement had run.
 *
 * Assumes layout has settled. Callers own the frame-waiting.
 */
export function measureProposalOverflow(annotate = false): OverflowingPage[] {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.print-page'))
  const found: OverflowingPage[] = []

  pages.forEach((pageEl, i) => {
    const well = pageEl.querySelector<HTMLElement>('.well')
    if (!well) return
    // Use the footer bar's actual top edge as the clipping boundary. Comparing
    // scrollHeight against a padding-adjusted clientHeight does not work for
    // overflow:visible elements (which .well is): scrollHeight clamps to
    // clientHeight when content is shorter than the box, producing a false
    // positive equal to paddingTop + paddingBottom (~141 px) on every page.
    //
    // Instead: find the bottommost in-flow child's getBoundingClientRect().bottom
    // and compare it against the clipping boundary. When a footer bar is present
    // the boundary is its top edge (content past it hides behind the opaque bar);
    // on a noFooter sheet (cover, thank-you) there is no footer, so the boundary
    // is the sheet's own bottom edge — .print-page is overflow:hidden, and a
    // footerless page is entitled to run all the way down to it. Falling back to 0
    // here reported every footerless page as overflowing by its own distance down
    // the document (a large viewport-relative number), two permanent false
    // positives. In jsdom (tests) all rects are zero, so the boundary and every
    // maxChildBottom are 0 and overflowPx is always 0 — no false positives.
    const footerEl = pageEl.querySelector<HTMLElement>('.footer')
    const boundary = Math.round(
      footerEl
        ? footerEl.getBoundingClientRect().top
        : pageEl.getBoundingClientRect().bottom,
    )
    let maxChildBottom = 0
    for (const child of Array.from(well.children)) {
      if (getComputedStyle(child).position === 'absolute') continue
      const bottom = Math.round(child.getBoundingClientRect().bottom)
      if (bottom > maxChildBottom) maxChildBottom = bottom
    }
    const overflowPx = Math.max(0, maxChildBottom - boundary)

    if (overflowPx > TOLERANCE_PX) {
      found.push({
        page: i + 1,
        testId: pageEl.getAttribute('data-testid'),
        overflowPx: Math.round(overflowPx),
      })
      if (annotate) {
        pageEl.setAttribute('data-proposal-overflow', String(Math.round(overflowPx)))
      }
    } else if (annotate) {
      pageEl.removeAttribute('data-proposal-overflow')
    }
  })

  ;(window as unknown as { __PROPOSAL_OVERFLOW__?: OverflowingPage[] })
    .__PROPOSAL_OVERFLOW__ = found

  return found
}

/** Two frames: one for the commit to paint, one for layout to settle after any
 *  late font swap. One frame is measurably too early on first mount. */
export async function waitForLayout(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
}

export interface UseProposalOverflowOptions {
  /**
   * Gate measurement on this. Measuring before fonts and images resolve gives
   * meaningless numbers — a fallback face has different metrics entirely.
   */
  ready: boolean
  /**
   * Add data-proposal-overflow to overflowing pages, which the stylesheet turns
   * into a screen-only warning band.
   *
   * Must stay false on the print route: that DOM is what page.pdf() captures,
   * and a red QA band does not belong in a document that goes to a customer.
   */
  annotate?: boolean
  /** Re-measure when any of these change (zoom alters used values). */
  deps?: readonly unknown[]
}

export function useProposalOverflow({
  ready,
  annotate = false,
  deps = [],
}: UseProposalOverflowOptions): OverflowingPage[] {
  const [overflowing, setOverflowing] = useState<OverflowingPage[]>([])

  useEffect(() => {
    if (!ready) return
    let cancelled = false

    const measure = async () => {
      await waitForLayout()
      if (cancelled) return
      const found = measureProposalOverflow(annotate)
      if (cancelled) return
      setOverflowing(found)
    }

    void measure()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, annotate, ...deps])

  return overflowing
}
