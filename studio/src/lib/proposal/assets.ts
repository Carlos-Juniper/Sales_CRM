// ---------------------------------------------------------------------------
// Proposal background images that the readiness gate must await.
//
// The gate in ProposalPrintRoute enumerates <img> elements and decodes them,
// which covers headshots and portfolio photos (served via /proposal-assets/).
// It does NOT cover CSS background-image: those fetches are invisible to both
// document.fonts.ready and a querySelectorAll('img') sweep, so a capture can
// win the race against the fetch and emit a page with no watermark behind it.
//
// Every url() background declared in styles/proposal-print.css therefore needs
// an entry here. Same irreducible two-place duplication as the font list — the
// stylesheet cannot import TypeScript — so the CSS block points back at this
// file by name.
//
// CSS custom properties are set on :root by applyProposalAssetCssVars() so
// that proposal-print.css can reference them as var(--proposal-watermark).
//
// Brand marks (watermark, Florida map) are committed to git and served
// same-origin from /proposal/. Photography (headshots, service photos) is
// served through the /proposal-assets/{path} GCS proxy — see photos.ts.
// ---------------------------------------------------------------------------

const WATERMARK_URL = '/proposal/palm-watermark.jpeg'

/** Resolved URL for the Florida coverage map on the Local Experts page. */
export function floridaMapUrl(): string {
  return '/proposal/florida-map.png'
}

/**
 * Set CSS custom properties on :root so proposal-print.css can consume the
 * full url(...) as var(--proposal-watermark).
 *
 * Call once on mount in any route that renders proposal pages (ProposalPreview,
 * ProposalPrintRoute). Idempotent — safe to call multiple times.
 */
export function applyProposalAssetCssVars(): void {
  document.documentElement.style.setProperty(
    '--proposal-watermark',
    `url("${WATERMARK_URL}")`,
  )
}

/** The full resolved URLs used by the readiness gate. */
export const PROPOSAL_BACKGROUND_IMAGES: readonly string[] = [WATERMARK_URL]

/**
 * Fetch and decode each background image.
 *
 * Rejections are swallowed per-image on purpose: a missing watermark should
 * degrade to a white page, not hang the readiness gate and 503 the render. A
 * missing FONT is the opposite call — see the check in ProposalPrintRoute,
 * which fails the render rather than ship a proposal set in Arial.
 */
export async function preloadProposalBackgrounds(): Promise<void> {
  await Promise.all(
    PROPOSAL_BACKGROUND_IMAGES.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            void img.decode?.().catch(() => undefined).finally(() => resolve())
            if (!img.decode) resolve()
          }
          img.onerror = () => {
            console.error('[proposal] background image failed to load:', src)
            resolve()
          }
          img.src = src
        }),
    ),
  )
}
