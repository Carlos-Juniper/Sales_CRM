// ---------------------------------------------------------------------------
// Brand faces for the proposal document — single source of truth.
//
// Three things must agree or PDF rendering breaks:
//   1. the @font-face blocks in styles/proposal-print.css — the actual loading
//   2. the --jn-display / --jn-body / --jn-script tokens in that same file
//   3. BRAND_FACES below, which the print route asserts have resolved before it
//      flips window.__PROPOSAL_READY__
//
// The failure mode is asymmetric and worth spelling out. If (3) names a face
// that (1) does not load, document.fonts.check() returns false forever, the
// readiness flag never flips, and *every* server render times out — a silent,
// total outage of PDF generation, not a cosmetic bug. That check is deliberate:
// it is what stops a client-facing proposal going out set in Arial.
//
// Adding or swapping a face therefore means editing this file AND the CSS. The
// stylesheet cannot import TypeScript, so the duplication is irreducible — but
// it is now two places that reference each other by name instead of a bare
// string array 600 lines away from the @font-face rules.
// ---------------------------------------------------------------------------

export interface BrandFace {
  family: string
  weight: 400 | 700
  /** Filename under studio/public/fonts/. Must match the @font-face `src`. */
  file: string
}

/**
 * Every face the document sets, matching styles/proposal-print.css.
 *
 * Lato (display), Open Sans (body) and Mrs Saint Delafield (signature script)
 * are the faces embedded in the real Proposify exports. All three are Google
 * Fonts under OFL/Apache, so self-hosting and server-side embedding are clear.
 */
export const BRAND_FONT_FACES: readonly BrandFace[] = [
  { family: 'Lato', weight: 400, file: 'lato-400.woff2' },
  { family: 'Lato', weight: 700, file: 'lato-700.woff2' },
  { family: 'Open Sans', weight: 400, file: 'opensans-400.woff2' },
  { family: 'Open Sans', weight: 700, file: 'opensans-700.woff2' },
  { family: 'Mrs Saint Delafield', weight: 400, file: 'mrs-saint-delafield-400.woff2' },
] as const

/**
 * CSS font shorthands for `document.fonts.load()` / `document.fonts.check()`.
 *
 * The 12px size is arbitrary and never rendered — the Font Loading API matches
 * on family and weight, and a size is only required for the shorthand to parse.
 */
export const BRAND_FACES: readonly string[] = BRAND_FONT_FACES.map(
  (f) => `${f.weight} 12px "${f.family}"`,
)
