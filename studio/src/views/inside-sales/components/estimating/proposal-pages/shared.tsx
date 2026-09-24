// ---------------------------------------------------------------------------
// Shared building blocks for the proposal page components.
//
// Everything in here is used by two or more page files (or by the orchestrator
// in ProposalPreview.tsx). Page-specific helpers live beside their page.
// ---------------------------------------------------------------------------

/* The page components below are genuine components, but this module also has to
   export the constants and layout helpers they share (PRINT_STYLES,
   splitColumns, paginate, …). Splitting those into a second module purely to
   satisfy Fast Refresh would scatter one cohesive set of helpers across two
   files for no runtime benefit — this module is never the hot-reload boundary,
   the page files are. */
/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useState } from 'react'
import '@/styles/proposal-print.css'
import { JuniperLogoFull, JuniperLeaves } from '@/components/brand/JuniperLogo'
import { COMPANY_INFO, formatWebsiteLabel } from '@/lib/constants'
import { SERVICES_CONTENT } from '@/lib/proposal/staticContent'
import type { CopyList } from '@/lib/proposal/staticContent'
import {
  serviceDetailPhotoUrls,
  orgIconUrl,
  bundledHeadshotUrl,
  proposalAssetUrl,
} from '@/lib/proposal/photos'
import { useProposalMediaUrl } from '@/hooks/useProposals'
import { teamMemberTitleLabel } from '@/lib/proposal/titleLabels'
import type {
  TeamMember,
  LicenseCertification,
  ProposalSigner,
} from '@/types/proposal'

// ---------------------------------------------------------------------------
// Print stylesheet — injected once as a <style> tag inside the preview
// wrapper. Mirrors the proven approach from ProposalExport.tsx.
// ---------------------------------------------------------------------------

export const PRINT_STYLES = `
@media print {
  /* Chrome drops every background colour and image when printing unless this is
     set. The server render passes print_background=True, but an in-app Cmd+P
     goes through the print dialog and needs the declaration. */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* AppShell wraps the whole SPA in h-screen + overflow-hidden (see
     components/layout/AppShell.tsx). A clipping ancestor chain truncates print
     output to one viewport, which is why Cmd+P inside the app emits a single
     page. Unclip the shell so pagination sees the real document height.
     The /proposals/:id/print route mounts outside AppShell and is unaffected. */
  html, body {
    height: auto !important;
    overflow: visible !important;
  }
  body:not([data-print-route]) [data-app-shell],
  body:not([data-print-route]) [data-app-shell-main] {
    display: block !important;
    height: auto !important;
    width: auto !important;
    overflow: visible !important;
  }

  body:not([data-print-route]) * { visibility: hidden !important; }
  body:not([data-print-route]) #proposal-preview,
  body:not([data-print-route]) #proposal-preview * { visibility: visible !important; }
  body:not([data-print-route]) #proposal-preview { position: absolute; top: 0; left: 0; width: 100%; }
  .no-print { display: none !important; }
  /* Page size, .print-page geometry and the footer bar live in
     styles/proposal-print.css and apply on screen too — the preview is meant to
     be the PDF. Only genuinely print-only rules belong in this block. */
  /* Prevent cohesive blocks from splitting across pages */
  .signer-block,
  .team-card,
  .reference-entry,
  .org-row,
  .org-peers,
  .startup-plan-row,
  .insurance-block {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`

// ---------------------------------------------------------------------------
// PrintPage — wrapper enforcing one browser-page per proposal page
//
// The letterhead bar that used to sit at the top of every page is gone: the
// real proposals carry the brand in a full-bleed footer instead, and repeating
// a 1in green header on all 23 pages cost more vertical space than any page
// could spare.
// ---------------------------------------------------------------------------

// Page numbers are rendered by React, not by Chromium. page.pdf()'s
// <span class="pageNumber"> only works inside the margin box, and @page
// margin:0 leaves no margin box (see styles/proposal-print.css).
//
// Context rather than a prop so the ~20 page components don't each have to
// forward a number they don't care about. ProposalPreview owns the order and
// provides the value; PrintPage consumes it. 0 means "not inside a numbered
// document" and renders no number.
export const PageNumberContext = createContext(0)

export function PrintPage({
  children,
  overlay,
  'data-testid': testId,
  className,
  hideNumber = false,
  noFrond = false,
  noFooter = false,
}: {
  children: React.ReactNode
  /**
   * Sheet-anchored content rendered as a direct child of .print-page, OUTSIDE
   * the padded .well. Use for elements whose position must be measured from the
   * paper edge (e.g. the cover date pill), not from the well's content box —
   * the well reserves ~61pt of bottom padding for the footer, which would
   * otherwise float a bottom-anchored element that far too high.
   */
  overlay?: React.ReactNode
  'data-testid'?: string
  /**
   * Extra class(es) on the .print-page sheet itself — for page-type layout hooks
   * the stylesheet keys on (e.g. `portfolio`, which makes the well a column flex
   * container so a single image sizes to whatever the title leaves).
   */
  className?: string
  hideNumber?: boolean
  /**
   * Suppress the palm-frond watermark on this sheet.
   *
   * The frond is now painted on EVERY page by default (`.print-page frond`),
   * matching the reference, which carries the watermark throughout. This is the
   * escape hatch — set it on a sheet whose content would collide with the art
   * (e.g. a full-bleed photo page). It adds the `.no-frond` class, which the
   * `.print-page.frond.no-frond::before` rule in proposal-print.css uses to hide
   * the art. No page currently needs it off. See Handoff 46 §2.4 for the asset
   * and opacity rationale.
   */
  noFrond?: boolean
  /**
   * Suppress the green footer bar entirely.
   *
   * The reference omits it on exactly two pages — the cover and the closing
   * page — verified by a rect census (pages with no 48pt green rect = [1, 41]).
   */
  noFooter?: boolean
}) {
  const pageNumber = useContext(PageNumberContext)
  return (
    <div
      className={`print-page frond${noFrond ? ' no-frond' : ''}${className ? ` ${className}` : ''}`}
      data-testid={testId}
    >
      <div className="well">{children}</div>
      {overlay}
      {!noFooter && (
        <div className="footer">
          <JuniperLogoFull variant="white" className="mark" title={COMPANY_INFO.name} />
          <span className="meta">
            {COMPANY_INFO.website ? (
              <a className="footer-website" href={COMPANY_INFO.website}>
                {formatWebsiteLabel(COMPANY_INFO.website)}
              </a>
            ) : null}
            {COMPANY_INFO.website && !(hideNumber || pageNumber < 1) ? '  |  ' : null}
            {hideNumber || pageNumber < 1 ? null : String(pageNumber)}
          </span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Headshot image component — resolves objectKey to signed URL
// ---------------------------------------------------------------------------

export function ProposalHeadshot({
  objectKey,
  name,
  className = '',
}: {
  objectKey: string | null
  name: string
  className?: string
}) {
  const [bundledError, setBundledError] = useState(false)
  const { data } = useProposalMediaUrl(objectKey)
  if (!objectKey || !data?.url) {
    // A rep-uploaded portrait wins (the objectKey path above). With none, fall
    // back to a bundled brand headshot if we shipped one for this person.
    const bundled = bundledHeadshotUrl(name)
    if (bundled && !bundledError)
      return <img src={bundled} alt={name} className={className} onError={() => setBundledError(true)} />
    // No upload and no bundled frame: initials in the photo's own footprint
    // hold the layout without reading as a broken image.
    const initials = name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
    return <div className={`headshot-initials ${className}`}>{initials}</div>
  }
  return <img src={data.url} alt={name} className={className} />
}

// ---------------------------------------------------------------------------
// Portfolio photo component
// ---------------------------------------------------------------------------

export function PortfolioPhoto({
  objectKey,
  alt,
  loadedClassName = 'photo',
}: {
  objectKey: string
  alt: string
  /**
   * Class on the loaded <img>. Defaults to `photo` (the two-up before/after
   * collage keeps the hatch backdrop). The single portfolio image passes
   * `portfolio-photo` instead: it is object-fit:contain, so the hatch must NOT
   * ride along or its stripes show through the letterbox bars (Handoff 48 §4).
   */
  loadedClassName?: string
}) {
  const [error, setError] = useState(false)
  const [bundledError, setBundledError] = useState(false)
  // Rep-uploaded portfolio images are GCS objects in the attachments bucket —
  // resolve via the media URL hook (same path as ProposalHeadshot). The bulk
  // rasterized properties (migration 036) never went through that upload flow
  // though: their object keys live in the bundled proposal-assets bucket
  // instead, so when the signed-URL lookup comes back empty we fall back to
  // the same /proposal-assets/ proxy the bundled headshots use.
  const { data } = useProposalMediaUrl(objectKey)
  if (!error && data?.url) {
    return (
      <img
        src={data.url}
        alt={alt}
        className={loadedClassName}
        onError={() => setError(true)}
      />
    )
  }
  if (!bundledError) {
    return (
      <img
        src={proposalAssetUrl(objectKey)}
        alt={alt}
        className={loadedClassName}
        onError={() => setBundledError(true)}
      />
    )
  }
  const placeholderClass = loadedClassName === 'photo' ? 'photo' : `photo ${loadedClassName}`
  return <div className={placeholderClass} />
}

// ---------------------------------------------------------------------------
// Team member card (shared by MeetOurTeam and MeetOurTeamExecutive)
// ---------------------------------------------------------------------------

// Reference composition: a 3:4 portrait with a green-outlined bio panel beside
// it, and name/title/location in their own outlined box beneath the photo —
// not a borderless two-up grid. Both boxes are unfilled so the watermark shows
// through (pixel-verified at 288dpi).
export function TeamMemberCard({ member }: { member: TeamMember }) {
  return (
    <div className="team-card">
      <div>
        <ProposalHeadshot
          objectKey={member.headshotObjectKey}
          name={member.name}
          className="team-photo"
        />
        <div className="id-box">
          <p className="nm">{member.name}</p>
          <p className="ti">{teamMemberTitleLabel(member.title)}</p>
          {member.location && <p className="lo">{member.location}</p>}
        </div>
      </div>
      {member.bio ? (
        <div className="bio-box">
          <p className="bi">{member.bio}</p>
        </div>
      ) : null}
    </div>
  )
}

/** Canonical shape lives in @/types/proposal; aliased for the local call sites. */
export type SignerInfo = ProposalSigner

// The signature, then the same name again in the block below it — that
// repetition is the real proposals' convention, not a bug.
export function SignerBlock({ signer }: { signer: SignerInfo }) {
  return (
    <div className="signer-block">
      <p className="signature">{signer.name}</p>
      <p className="signer-lines">
        <strong>{signer.name}</strong>
        <br />
        {signer.title}
        {signer.phone && (
          <>
            <br />
            {signer.phone}
          </>
        )}
        {signer.email && (
          <>
            <br />
            {signer.email}
          </>
        )}
        {signer.branchAddress && (
          <>
            <br />
            {signer.branchAddress}
          </>
        )}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared copy renderers (A1)
//
// The approved deck opens service pages with a short claim (subhead) and closes
// them with one or more labelled bullet lists whose items can carry a bold
// lead-in. These helpers render those fields when present and render nothing
// when absent, so existing content — which has neither field yet — is unchanged.
// ---------------------------------------------------------------------------

export function LeafBullet() {
  return <JuniperLeaves aria-hidden />
}

/** Renders labelled bullet lists. Returns null when the list array is empty/absent. */
export function CopyLists({ lists }: { lists?: CopyList[] }) {
  if (!lists || lists.length === 0) return null
  return (
    <>
      {lists.map((list, i) => (
        <div className="copy-list" key={i}>
          {list.label
            ? (
              <p className={
                list.label.trim().endsWith('?')
                  ? `copy-list-label-q${list.labelColor === 'orange' ? ' copy-list-label-q-orange' : ''}${list.labelLarge ? ' copy-list-label-q-large' : ''}`
                  : list.labelColor === 'green' ? 'copy-list-label-green' : 'copy-list-label'
              }>
                {list.label}
              </p>
            )
            : null}
          {list.intro ? <p className="copy-list-intro">{list.intro}</p> : null}
          {list.unbulleted
            ? (
              <div className="copy-list-prose">
                {list.items.map((item, j) => (
                  <p key={j}>
                    {item.lead ? <span className="copy-list-item-lead">{item.lead}:</span> : null}{' '}
                    {item.text}
                  </p>
                ))}
              </div>
            )
            : list.bulletStyle === 'dot'
              ? (
                <ul className="dot">
                  {list.items.map((item, j) => (
                    <li key={j}>
                      {item.lead ? <span className="copy-list-item-lead">{item.lead}:</span> : null}{' '}
                      {item.text}
                    </li>
                  ))}
                </ul>
              )
              : list.bulletStyle === 'check'
                ? (
                  <ul className="check">
                    {list.items.map((item, j) => (
                      <li key={j}>
                        {item.lead ? <span className="copy-list-item-lead">{item.lead}:</span> : null}{' '}
                        {item.text}
                      </li>
                    ))}
                  </ul>
                )
                : (
                  <ul className="leaf">
                    {list.items.map((item, j) => (
                      <li key={j}>
                        <span className="leaf-bullet"><LeafBullet /></span>
                        {item.lead ? <span className="copy-list-item-lead">{item.lead}:</span> : null}{' '}
                        {item.text}
                      </li>
                    ))}
                  </ul>
                )}
        </div>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Balance body paragraphs across two columns, first column taking the extra. */
export function splitColumns(paras: string[]): [string[], string[]] {
  const half = Math.ceil(paras.length / 2)
  return [paras.slice(0, half), paras.slice(half)]
}

/** Split into fixed-size groups, so a grid can paginate instead of truncate. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/**
 * chunk(), but an empty list still yields one empty page.
 *
 * For pages that are part of the document's fixed structure. Meet Our Team is
 * a required page, so a rep who has picked nobody should see it sitting empty
 * and realise the picker is blank — silently dropping the page hides the
 * mistake until a client asks who they will be working with.
 *
 * The opposite call is right for Portfolio, which is dropped entirely when no
 * property has photos: that page is a photo grid, and a name over an empty box
 * reads as a broken document rather than an omission.
 */
export function paginate<T>(items: T[], size: number): T[][] {
  const groups = chunk(items, size)
  return groups.length > 0 ? groups : [[]]
}

// ---------------------------------------------------------------------------
// Org chart nodes (used by OrgChartPage)
// ---------------------------------------------------------------------------

export function CrewRow({ label, count }: { label: string; count: string }) {
  return (
    <div className="org-node org-crew">
      {/* icon-5 is the square group glyph, badged orange to mark a crew (vs. a named role). */}
      <div className="org-avatar org-avatar-team">
        <img className="org-icon" src={orgIconUrl('org-icon-5.png')} alt="" />
      </div>
      <div className="t">{label}</div>
      <div className="crew-count">{count}</div>
    </div>
  )
}

export function OrgNode({ title, name, filled = false }: { title: string; name: string; filled?: boolean }) {
  return (
    <div className={filled ? 'org-node filled' : 'org-node'}>
      {/* icon-2 is the square single-person glyph, for individual-role nodes. */}
      <div className="org-avatar">
        <img className="org-icon" src={orgIconUrl('org-icon-2.png')} alt="" />
      </div>
      <div className="t">{title}</div>
      <div className="n">{name}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Our Services — 10 subpages, one per service key. (Juniper Cares is not a
// service; it renders as its own standalone section — see JuniperCaresPage.)
// ---------------------------------------------------------------------------

export type ServiceKey = keyof typeof SERVICES_CONTENT

export const SERVICE_KEYS: ServiceKey[] = [
  'services_design',
  'services_maintenance',
  'services_installation',
  'services_turf',
  'services_irrigation',
  'services_arboriculture',
  'services_storm_response',
  'services_enhancements',
  'services_aquatics',
  'services_safety_training',
]

/**
 * Photo block for a light-content service page: a full-width hero, then
 * whatever supporting photos are curated for that service. Design has a
 * third curated frame (see SERVICE_SUPPORT_PHOTOS_2) and gets a 2-across row
 * to match the reference exactly; every other service falls back to a single
 * stacked photo using the card photo that already ships for it.
 *
 * The second photo only renders when both:
 *  - the list is short enough to leave room for it under the (now taller)
 *    hero — services with a longer bullet list push the sheet's footer bar
 *    without it (verified against the overflow guard: Storm
 *    Response/Enhancements/Aquatics/Safety Training all clip with a second
 *    photo, everything at or under Design's 3 items does not), and
 *  Slice 4 will replace this stub with the full collage layout.
 */
export type CollageShape = 'solo' | 'solo-compact' | 'stack2' | 'hero-row2' | 'l-left' | 'split-tall'

const SERVICE_COLLAGE_SHAPE: Partial<Record<ServiceKey, CollageShape>> = {
  services_installation: 'split-tall',  // 2 left + 1 tall right (reference)
  services_enhancements: 'l-left',      // big left + 2 stacked right (reference)
  // Aquatics carries a subhead plus an 8-item bullet list above its single
  // photo — solo's 3.00in floor pushed the photo's bottom under the footer.
  services_aquatics: 'solo-compact',
}

export function ServicePhotoCluster({ serviceKey }: { serviceKey: ServiceKey }) {
  const photos = serviceDetailPhotoUrls(serviceKey)
  const shape: CollageShape =
    SERVICE_COLLAGE_SHAPE[serviceKey] ??
    (photos.length === 1 ? 'solo' : photos.length === 2 ? 'stack2' : 'hero-row2')

  return (
    <div className={`service-collage ${shape}`}>
      {photos.map((url, i) => (
        <img key={i} src={url} alt="" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Meet Our Team pagination
// ---------------------------------------------------------------------------

// Three per sheet, matching the reference — and load-bearing, not cosmetic. A
// card is a 1.93in photo plus a 0.688in id-box, ~2.75in tall; the well leaves
// ~8.2in under the title block, so a fourth card would push content off a page
// that clips rather than reflows. Rendering every pick on one sheet (as this
// did before the cards were rebuilt to the reference composition) silently
// dropped the surplus.
export const TEAM_CARDS_PER_PAGE = 3

// ---------------------------------------------------------------------------
// Licenses & certifications image (used by LicensesCertificationsPage)
// ---------------------------------------------------------------------------

export function LicenseImage({ item }: { item: LicenseCertification }) {
  const [error, setError] = useState(false)
  const { data } = useProposalMediaUrl(item.objectKey)
  if (!data?.url || error) return null
  return (
    <img
      src={data.url}
      alt={`${item.name}${item.identifier ? ` — No. ${item.identifier}` : ''}`}
      className="license-cert-img"
      onError={() => setError(true)}
    />
  )
}
