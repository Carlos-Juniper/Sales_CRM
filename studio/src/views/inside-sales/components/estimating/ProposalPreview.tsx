// ---------------------------------------------------------------------------
// ProposalPreview — full page-by-page print-ready preview (Handoff 37, Slice 8)
//
// Satisfies ProposalPreviewSlotProps from ProposalBuilder.tsx.
// Each proposal page is its own sub-component wrapped in a .print-page div —
// they live one-per-file under ./proposal-pages/, with the pieces they share
// (PrintPage, the page-number context, copy renderers, layout helpers) in
// ./proposal-pages/shared.tsx. This file owns the page ORDER and numbering.
//
// §2 page order (fixed). The cover is unnumbered, so the printed number on the
// intro letter is 2 and every page below is one higher than its list position:
//  0. CoverPage           — property name + city, no page number
//  1. IntroLetter         — variable signer block
//  2. RootedInFlorida     — static
//  3. LocalLandscapeExperts — live branch coverage + variable proximity footer
//  4. OrgChartPage        — dynamic tree, conditional nodes
//  5–14. ServicesPages    — 10 static blurbs (Juniper Cares is not a service)
//  JuniperCares           — standalone section (§6), after the service pages
//  16. StartupCommunication — static
//  17. CustomerCare       — static
//  MeetOurTeamExecutive   — leadership roster, when one exists (before the team)
//  18. MeetOurTeam        — picked branch team members
//  19. ClientReferences   — picked refs
//  20. Insurance          — static copy + cert object/expiry
//  21. LicensesCerts      — live credentials, prose fallback while the table is bare
//  22. Portfolio          — picked properties + photos
//
// Optional pages (render only when their key is in formState.sections), in this
// order, after Portfolio:
//  StartupPlan306090, JuniperSync, JuniperMapping (2 pages)
// (MeetOurTeamExecutive is no longer gated here — it renders before the team
//  page whenever an executive roster exists.)
//
// Then, always last:
//  ThankYou              — variable signer block
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import '@/styles/proposal-print.css'
import { COMPANY_INFO } from '@/lib/constants'
import { nearestBranches } from '@/lib/proposal/proximity'
import { useProposalConfig, useProposalLicenses } from '@/hooks/useProposals'
import { applyProposalAssetCssVars } from '@/lib/proposal/assets'
import { naturalBodyChapterKeys, resolveChapterOrder, chapterTitle } from '@/lib/proposal/chapters'
import { useProposalAppendedDocuments } from '@/hooks/useProposalDocument'
import { ProposalDocumentToolbar } from './ProposalDocumentToolbar'
import type { ProposalPreviewSlotProps } from './ProposalBuilder'
import type {
  TeamMember,
  ClientReference,
  PortfolioProperty,
} from '@/types/proposal'
import {
  PRINT_STYLES,
  PageNumberContext,
  SERVICE_KEYS,
  TEAM_CARDS_PER_PAGE,
  paginate,
  type SignerInfo,
} from './proposal-pages/shared'
import { CoverPage } from './proposal-pages/cover-page'
import { IntroLetter } from './proposal-pages/intro-letter'
import { RootedInFlorida } from './proposal-pages/rooted-in-florida'
import { LocalLandscapeExperts } from './proposal-pages/local-landscape-experts'
import { OrgChartPage } from './proposal-pages/org-chart-page'
import { ServiceOverviewPage } from './proposal-pages/service-overview-page'
import { ServicePage } from './proposal-pages/service-page'
import { IrrigationReportingSamplePage } from './proposal-pages/irrigation-reporting-sample-page'
import { JuniperCaresPage } from './proposal-pages/juniper-cares-page'
import { StartupCommunication } from './proposal-pages/startup-communication'
import { CustomerCare } from './proposal-pages/customer-care'
import { StartupPlan306090 } from './proposal-pages/startup-plan-30-60-90'
import { JuniperSyncPage } from './proposal-pages/juniper-sync-page'
import { JuniperMappingPage } from './proposal-pages/juniper-mapping-page'
import { MeetOurTeamExecutive } from './proposal-pages/meet-our-team-executive'
import { MeetOurTeam } from './proposal-pages/meet-our-team'
import { ClientReferencesPage } from './proposal-pages/client-references-page'
import { InsurancePage } from './proposal-pages/insurance-page'
import { LicensesCertificationsPage } from './proposal-pages/licenses-certifications-page'
import { PortfolioPropertyPage } from './proposal-pages/portfolio-property-page'
import { ThankYouPage } from './proposal-pages/thank-you-page'
import { TableOfContentsPage, type TocEntry } from './proposal-pages/table-of-contents-page'

// ---------------------------------------------------------------------------
// ProposalPreview — main exported component
// ---------------------------------------------------------------------------

interface ProposalPreviewProps extends ProposalPreviewSlotProps {
  /** All active team members (for org chart resolution + meet-our-team). */
  allTeamMembers: TeamMember[]
  /** Resolved team members for page 18 picks. */
  teamMembers: TeamMember[]
  /** Resolved executive team members for optional page. */
  executiveTeamMembers: TeamMember[]
  /** Resolved client references for page 19. */
  clientReferences: ClientReference[]
  /** Resolved portfolio properties for page 21. */
  portfolioProperties: PortfolioProperty[]
  /**
   * Render the Back / Generate PDF / Print bar above the document.
   *
   * Defaults to true for the builder's inline preview. The full-screen route
   * sets it false and supplies its own sticky bar (Back + zoom + the same PDF
   * actions); the print route sets it false so the headless capture sees the
   * document and nothing else.
   */
  showActionBar?: boolean
  /**
   * Resolved signer for the intro letter and thank-you page, from
   * useProposalDocument. Omitted only by callers that have no user list to
   * resolve against, which then get the unnamed fallback below.
   */
  signer?: SignerInfo
}

export function ProposalPreview({
  formState,
  lead,
  estimate,
  onBack,
  proposalId,
  chapterOrder = null,
  allTeamMembers,
  teamMembers,
  executiveTeamMembers,
  clientReferences,
  portfolioProperties,
  showActionBar = true,
  signer: signerProp,
}: ProposalPreviewProps) {
  // Wire CSS custom properties so proposal-print.css can reference the
  // watermark via var(--proposal-watermark).
  // Called on mount; idempotent if the route re-renders.
  useEffect(() => {
    applyProposalAssetCssVars()
  }, [])

  const { branches, branchCoverage, insurance } = useProposalConfig()
  // Branch scoping: the estimate carries aspireBranchId (Slice 8), same source
  // ProposalBuilder uses to scope team members and client references. Absent
  // for estimate-optional proposals (WS2), in which case the backend falls
  // back to company-wide (aspire_branch_id IS NULL) rows only.
  const aspireBranchId: number | undefined = estimate?.aspireBranchId ?? undefined
  const { data: credentials } = useProposalLicenses(
    aspireBranchId !== undefined ? { aspireBranchId } : undefined,
  )

  // Proximity footer: 2–3 nearest branches to the lead's lat/lng
  const nearbyBranches = nearestBranches(lead.lat, lead.lng, branches, 3)

  // Resolved upstream by useProposalDocument, which gates the print route's
  // readiness flag on the user list so a PDF cannot capture before the rep's
  // name is known.
  //
  // The fallback names nobody on purpose. It used to interpolate the raw id —
  // `Rep (user: usr-a1b2c3)` — into a letter that goes to a customer, which is
  // strictly worse than an unnamed but well-formed signature block.
  const signer: SignerInfo = signerProp ?? {
    name: 'Your Juniper Representative',
    title: 'Account Manager',
    phone: COMPANY_INFO.phone,
    email: COMPANY_INFO.email,
    branchAddress: COMPANY_INFO.address,
  }

  const sections = new Set(formState.sections)

  // Portfolio photos are not uploaded yet. A property with no photo is a name
  // over an empty box, so it is dropped; if none have photos the page goes too.
  const photographedProperties = portfolioProperties.filter(
    (p) => p.photoObjectKeys.length > 0,
  )

  // Body chapters (§2 content), keyed for the reorder feature. Cover, Intro
  // Letter, and Closing are locked and live outside this map entirely — see
  // lib/proposal/chapters.ts, which the reorder panel also reads from so the
  // two can never disagree about which chapters exist or what they're called.
  const chapterPages: Record<string, { key: string; node: React.ReactNode }[]> = {
    'rooted-in-florida': [
      { key: 'rooted', node: <RootedInFlorida coverage={branchCoverage} /> },
    ],
    'local-landscape-experts': [
      { key: 'local', node: <LocalLandscapeExperts coverage={branchCoverage} nearbyBranches={nearbyBranches} /> },
    ],
    'org-chart': formState.orgChart.included
      ? [{
          key: 'org',
          node: <OrgChartPage orgChart={formState.orgChart} teamMembers={allTeamMembers} aspireBranchId={estimate?.aspireBranchId} signer={signer} />,
        }]
      : [],
    // One overview sheet of six capability groups, then the per-service detail
    // pages — the reference's order. The overview is the six-cell capability
    // grid (two rows of three); the eleven service keys still each get a detail
    // page below.
    'our-services': [
      { key: 'services-overview', node: <ServiceOverviewPage /> },
      ...SERVICE_KEYS.flatMap((key) => [
        { key: `service-${key}`, node: <ServicePage serviceKey={key} /> },
        // Optional add-on: sample report screenshots right after the Landscape
        // Irrigation detail page, not a service of its own.
        ...(key === 'services_irrigation' && sections.has('irrigation_reporting_sample')
          ? [{ key: 'irrigation-reporting-sample', node: <IrrigationReportingSamplePage /> }]
          : []),
      ]),
    ],
    // Juniper Cares is its own section (§6), rendered after the service detail
    // pages and before Start Up Communication.
    'juniper-cares': [{ key: 'juniper-cares', node: <JuniperCaresPage /> }],
    'startup-communication': [{ key: 'startup-comm', node: <StartupCommunication /> }],
    'customer-care': [{ key: 'customer-care', node: <CustomerCare /> }],
    'startup-plan': sections.has('startup_plan_30_60_90')
      ? [{ key: 'startup-plan', node: <StartupPlan306090 startupPlan={formState.startupPlan} /> }]
      : [],
    'juniper-sync': sections.has('juniper_sync')
      ? [{ key: 'sync', node: <JuniperSyncPage /> }]
      : [],
    'juniper-mapping': sections.has('juniper_mapping')
      ? [
          { key: 'mapping-1', node: <JuniperMappingPage half="pageOne" /> },
          { key: 'mapping-2', node: <JuniperMappingPage half="pageTwo" /> },
        ]
      : [],
    // Rendered whenever an executive roster exists, not gated on the optional
    // section flag: the executives ship on every proposal that has them.
    'meet-the-team-executive': executiveTeamMembers.length > 0
      ? paginate(executiveTeamMembers, TEAM_CARDS_PER_PAGE).map((group, i, all) => ({
          key: `team-exec-${i}`,
          node: (
            <MeetOurTeamExecutive
              members={group}
              pageIndex={i}
              totalPages={all.length}
            />
          ),
        }))
      : [],
    'meet-the-team': paginate(teamMembers, TEAM_CARDS_PER_PAGE).map((group, i, all) => ({
      key: `team-${i}`,
      node: <MeetOurTeam members={group} pageIndex={i} totalPages={all.length} />,
    })),
    'references': [{ key: 'references', node: <ClientReferencesPage refs={clientReferences} /> }],
    'insurance': [{ key: 'insurance', node: <InsurancePage cert={insurance} /> }],
    'licenses': [{
      key: 'licenses',
      node: (
        <LicensesCertificationsPage
          licenses={credentials?.licenses ?? []}
          certifications={credentials?.certifications ?? []}
        />
      ),
    }],
    // One sheet per property (§3): one photo page per photographed property.
    // photographedProperties arrives pre-sorted by sort_order from the backend
    // (proposals.py) and .filter() preserves that order, so sheets are in
    // sortOrder without a re-sort here.
    'portfolio': photographedProperties.map((p) => ({
      key: `portfolio-${p.id}`,
      node: <PortfolioPropertyPage property={p} />,
    })),
  }

  const naturalChapterKeys = naturalBodyChapterKeys({
    sections,
    hasOrgChart: formState.orgChart.included,
    hasExecutiveTeam: executiveTeamMembers.length > 0,
    hasPortfolio: photographedProperties.length > 0,
  })
  const orderedChapterKeys = resolveChapterOrder(naturalChapterKeys, chapterOrder)

  // Required and implicit, like the intro letter — never in formState.sections.
  // Cover and Intro Letter are locked at the front, Closing locked at the back;
  // none of the three are reorderable chapters.
  const pagesWithoutToc: { key: string; node: React.ReactNode }[] = [
    { key: 'cover', node: <CoverPage lead={lead} signer={signer} /> },
    { key: 'intro', node: <IntroLetter lead={lead} signer={signer} /> },
    ...orderedChapterKeys.flatMap((k) => chapterPages[k] ?? []),
    // Closing letter is the final page.
    { key: 'thank-you', node: <ThankYouPage signer={signer} /> },
  ]

  // TOC is inserted right after the Intro Letter, so every page from here on
  // shifts down by exactly one. Computed from pagesWithoutToc (plain data, no
  // JSX dependency) before the TOC's own node is built, so there is no
  // chicken-and-egg problem between "which page is the TOC" and "what page
  // number does the TOC print for each chapter."
  const tocEnabled = sections.has('table_of_contents')
  const TOC_INDEX = 2
  const tocEntries: TocEntry[] = tocEnabled
    ? orderedChapterKeys.flatMap((k) => {
        const firstPage = chapterPages[k]?.[0]
        if (!firstPage) return []
        const naturalIndex = pagesWithoutToc.findIndex((p) => p.key === firstPage.key)
        return naturalIndex < 0 ? [] : [{ key: k, title: chapterTitle(k), pageNumber: naturalIndex + 1 }]
      })
    : []

  const pages: { key: string; node: React.ReactNode }[] = tocEnabled
    ? [
        ...pagesWithoutToc.slice(0, TOC_INDEX),
        { key: 'toc', node: <TableOfContentsPage entries={tocEntries} /> },
        ...pagesWithoutToc.slice(TOC_INDEX),
      ]
    : pagesWithoutToc

  return (
    <>
      <style>{PRINT_STYLES}</style>

      {showActionBar && (
        <ProposalDocumentToolbar
          proposalId={proposalId ?? null}
          onBack={onBack}
          className="mb-4"
        />
      )}

      {/* All proposal pages */}
      <div
        id="proposal-preview"
        className="proposal-root text-sm rounded-xl border border-[hsl(var(--border))] overflow-hidden print:border-0 print:rounded-none space-y-0"
        data-testid="proposal-preview"
      >
        {/* Each entry is exactly one .print-page — one sheet of paper. The array
            is the page order, and the index is the printed page number, so
            inserting or dropping a page renumbers the rest for free.

            value={i} (not i+1) so the printed number is the physical index minus
            one, matching the reference: cover (i=0) and intro letter (i=1) both
            unnumbered, Rooted in Florida (i=2) prints "2". The cover suppresses
            via value<1; the intro letter needs hideNumber on its PrintPage. */}
        {pages.map((page, i) => (
          <PageNumberContext.Provider key={page.key} value={i}>
            {page.node}
          </PageNumberContext.Provider>
        ))}
      </div>

      {/* Appended-documents summary (Handoff 47 §6). Deliberately OUTSIDE the
          #proposal-preview page loop and NOT a .print-page: the pages[] index is
          the printed page number, so a sheet here would renumber the document.
          It is display:none in print (.no-print) so the headless capture — which
          mounts this same component on the print route — never sees it. The
          appended PDFs cannot render in this React preview, so this panel is how
          a rep sees what will land at the tail. */}
      <ProposalDocumentSummaryPanel estimateId={estimate?.id ?? null} leadId={estimate ? null : lead.id} />
    </>
  )
}

// ---------------------------------------------------------------------------
// ProposalDocumentSummaryPanel — non-printing list of the documents that will
// be appended to the tail of the rendered PDF, in append order (measurements →
// contract → other). Page counts come from the server-side read at confirm
// (§6/§7), surfaced as attachment.pageCount.
// ---------------------------------------------------------------------------

const PROPOSAL_DOC_LABEL: Record<
  'proposal_measurements' | 'proposal_contract' | 'proposal_other',
  string
> = {
  proposal_measurements: 'Measurements',
  proposal_contract: 'Contract',
  proposal_other: 'Other attachment',
}


function ProposalDocumentSummaryPanel({
  estimateId,
  leadId,
}: {
  estimateId: string | null
  leadId?: string | null
}) {
  const { data: docs = [] } = useProposalAppendedDocuments(estimateId, leadId)

  if (docs.length === 0) return null

  const totalPages = docs.reduce((sum, d) => sum + (d.pageCount ?? 0), 0)

  return (
    <div
      className="no-print mt-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
      data-testid="appended-documents-summary"
    >
      <p className="mb-1 text-[13px] font-semibold text-[hsl(var(--fg))]">
        Appended documents
      </p>
      <p className="mb-3 text-[11px] text-[hsl(var(--muted-fg))]">
        These are appended to the end of the generated PDF, after the thank-you page, in this
        order. They do not appear in this on-screen preview.
      </p>
      <ul className="flex flex-col gap-1.5">
        {docs.map((d, i) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 tabular-nums text-[hsl(var(--muted-fg))]">{i + 1}.</span>
              <span className="shrink-0 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--muted-fg))]">
                {PROPOSAL_DOC_LABEL[d.kind as keyof typeof PROPOSAL_DOC_LABEL]}
              </span>
              <span className="truncate">{d.fileName}</span>
            </span>
            <span className="shrink-0 tabular-nums text-[hsl(var(--muted-fg))]">
              {d.pageCount != null ? `${d.pageCount} pg` : '—'}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] font-medium text-[hsl(var(--fg))]">
        {totalPages} appended {totalPages === 1 ? 'page' : 'pages'} total
      </p>
    </div>
  )
}
