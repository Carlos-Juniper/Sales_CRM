// ---------------------------------------------------------------------------
// Proposal background images that the readiness gate must await.
//
// The gate in ProposalPrintRoute enumerates <img> elements and decodes them,
// which covers headshots and portfolio photos. It does NOT cover CSS
// background-image: those fetches are invisible to both document.fonts.ready
// and a querySelectorAll('img') sweep, so a capture can win the race against
// the fetch and emit a page with no watermark behind it.
//
// Every url() background declared in styles/proposal-print.css therefore needs
// an entry here. Same irreducible two-place duplication as the font list — the
// stylesheet cannot import TypeScript — so the CSS block points back at this
// file by name.
//
// CSS custom properties for these assets are set on :root by
// applyProposalAssetCssVars() so that proposal-print.css can reference them as
// var(--proposal-watermark). This pattern is necessary because CSS url() cannot
// reference a var() that contains a base URL, and we need to support both the
// same-origin fallback and a GCS origin configured via
// VITE_PROPOSAL_ASSET_BASE at build time.
//
// The Florida map is an <img>, not a CSS background, so it needs neither a
// custom property nor a preload entry — the readiness gate's img sweep covers
// it. It still resolves through proposalAssetUrl() so it honours the asset
// base like every other proposal image.
// ---------------------------------------------------------------------------

/** Resolve an asset path against the configured asset base (or same-origin). */
function proposalAssetUrl(filename: string): string {
  const base = import.meta.env.VITE_PROPOSAL_ASSET_BASE as string | undefined
  if (base) {
    // Ensure no double-slash between base and filename.
    return `${base.replace(/\/$/, '')}/${filename}`
  }
  return `/proposal/${filename}`
}

const WATERMARK_URL = proposalAssetUrl('palm-watermark.jpeg')

/** Resolved URL for the Florida coverage map on the Local Experts page. */
export function floridaMapUrl(): string {
  return proposalAssetUrl('florida-map.png')
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
