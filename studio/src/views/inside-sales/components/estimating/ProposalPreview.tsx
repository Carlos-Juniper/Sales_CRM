// ---------------------------------------------------------------------------
// ProposalPreview — full page-by-page print-ready preview (Handoff 37, Slice 8)
//
// Satisfies ProposalPreviewSlotProps from ProposalBuilder.tsx.
// Each proposal page is its own sub-component wrapped in a .print-page div.
//
// Print CSS / letterhead treatment copied from ProposalExport.tsx (now dead
// code, deleted by Slice 9). Nothing here imports ProposalExport — it is safe
// to delete after this file is committed.
//
// §2 page order (fixed). The cover is unnumbered, so the printed number on the
// intro letter is 2 and every page below is one higher than its list position:
//  0. CoverPage           — property name + city, no page number
//  1. IntroLetter         — variable signer block
//  2. RootedInFlorida     — static
//  3. LocalLandscapeExperts — live branch coverage + variable proximity footer
//  4. OrgChartPage        — dynamic tree, conditional nodes
//  5–15. ServicesPages    — 11 static blurbs
//  16. StartupCommunication — static
//  17. CustomerCare       — static
//  18. MeetOurTeam        — picked branch team members
//  19. ClientReferences   — picked refs
//  20. Insurance          — static copy + cert object/expiry
//  21. Portfolio          — picked properties + photos
//  22. ThankYou           — variable signer block
//
// Optional pages (render only when their key is in formState.sections):
//  StartupPlan306090, JuniperSync, JuniperMapping (2 pages), MeetOurTeamExecutive
// ---------------------------------------------------------------------------

import { createContext, useContext, Fragment } from 'react'
import { ArrowLeft, Printer, FileDown, Loader2 } from 'lucide-react'
import '@/styles/proposal-print.css'
import { JuniperLogoFull, JuniperLeaves } from '@/components/brand/JuniperLogo'
import { COMPANY_INFO } from '@/lib/constants'
import {
  ROOTED_IN_FLORIDA_CONTENT,
  COMPANY_STATS,
  LOCAL_EXPERTS_CONTENT,
  SERVICES_CONTENT,
  STARTUP_COMMUNICATION_CONTENT,
  CUSTOMER_CARE_CONTENT,
  STARTUP_PLAN_SEED,
  INSURANCE_PAGE_COPY,
  JUNIPER_SYNC_CONTENT,
  JUNIPER_MAPPING_CONTENT,
} from '@/lib/proposal/staticContent'
import { nearestBranches } from '@/lib/proposal/proximity'
import { useProposalConfig, useProposalMediaUrl, useRenderProposal } from '@/hooks/useProposals'
import type { ProposalPreviewSlotProps } from './ProposalBuilder'
import type {
  TeamMember,
  ClientReference,
  PortfolioProperty,
  BranchCoverageGroup,
  BranchProfile,
  OrgChartInput,
  OrgChartCrewCounts,
  StartupPlanInput,
} from '@/types/proposal'
import type { ProposalFormState } from './ProposalBuilder'

// ---------------------------------------------------------------------------
// Print stylesheet — injected once as a <style> tag inside the preview
// wrapper. Mirrors the proven approach from ProposalExport.tsx.
// ---------------------------------------------------------------------------

const PRINT_STYLES = `
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
  .org-chart-node-group,
  .day-column,
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
// Context rather than a prop so the ~20 page components in this file don't each
// have to forward a number they don't care about. ProposalPreview owns the
// order and provides the value; PrintPage consumes it. 0 means "not inside a
// numbered document" and renders no number.
const PageNumberContext = createContext(0)

function PrintPage({
  children,
  'data-testid': testId,
  hideNumber = false,
  noFrond = false,
}: {
  children: React.ReactNode
  'data-testid'?: string
  hideNumber?: boolean
  noFrond?: boolean
}) {
  const pageNumber = useContext(PageNumberContext)
  return (
    <div className={noFrond ? 'print-page no-frond' : 'print-page'} data-testid={testId}>
      <div className="well">{children}</div>
      <div className="footer">
        <JuniperLogoFull variant="white" className="mark" title={COMPANY_INFO.name} />
        <span className="meta">
          {[COMPANY_INFO.website, hideNumber || pageNumber < 1 ? '' : String(pageNumber)]
            .filter(Boolean)
            .join('  |  ')}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Headshot image component — resolves objectKey to signed URL
// ---------------------------------------------------------------------------

function ProposalHeadshot({
  objectKey,
  name,
  className = '',
}: {
  objectKey: string | null
  name: string
  className?: string
}) {
  const { data } = useProposalMediaUrl(objectKey)
  if (!objectKey || !data?.url) {
    // Fallback: initials avatar
    const initials = name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
    return (
      <div className={`flex items-center justify-center rounded-full bg-[#2E7D52]/10 text-[#2E7D52] font-bold text-sm ${className}`}>
        {initials}
      </div>
    )
  }
  return (
    <img
      src={data.url}
      alt={name}
      className={`rounded-full object-cover ${className}`}
    />
  )
}

// ---------------------------------------------------------------------------
// Portfolio photo component
// ---------------------------------------------------------------------------

function PortfolioPhoto({ objectKey, alt }: { objectKey: string; alt: string }) {
  const { data } = useProposalMediaUrl(objectKey)
  if (!data?.url) return <div className="bg-gray-100 rounded aspect-video animate-pulse" />
  return (
    <img
      src={data.url}
      alt={alt}
      className="rounded aspect-video object-cover w-full"
    />
  )
}

// ---------------------------------------------------------------------------
// Team member card (shared by MeetOurTeam and MeetOurTeamExecutive)
// ---------------------------------------------------------------------------

function TeamMemberCard({ member }: { member: TeamMember }) {
  return (
    <div className="flex gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50">
      <ProposalHeadshot
        objectKey={member.headshotObjectKey}
        name={member.name}
        className="h-16 w-16 flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-gray-900">{member.name}</p>
        <p className="text-xs text-[#2E7D52] capitalize">
          {member.title.replace(/_/g, ' ')}
        </p>
        {member.location && (
          <p className="text-xs text-gray-500 mt-0.5">{member.location}</p>
        )}
        {member.bio && (
          <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{member.bio}</p>
        )}
      </div>
    </div>
  )
}

interface SignerInfo {
  name: string
  title: string
  phone: string
  email: string
  branchAddress: string
}

// The signature, then the same name again in the block below it — that
// repetition is the real proposals' convention, not a bug.
function SignerBlock({ signer }: { signer: SignerInfo }) {
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
// Cover — page 1, carries no page number (numbering starts on the letter)
// ---------------------------------------------------------------------------

function CoverPage({ lead }: { lead: { property_name: string; city: string; state: string } }) {
  return (
    <PrintPage data-testid="page-cover" hideNumber noFrond>
      <div className="cover">
        <JuniperLogoFull variant="color" className="cover-mark" title={COMPANY_INFO.name} />
        <p className="cover-eyebrow">Proposal for</p>
        <h1 className="page-title">{lead.property_name}</h1>
        <h1 className="page-title">
          {lead.city}
          {lead.city && lead.state ? ', ' : ''}
          {lead.state}
        </h1>
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 2 — Intro Letter
// ---------------------------------------------------------------------------

function IntroLetter({
  lead,
  signer,
}: {
  lead: { property_name: string }
  signer: SignerInfo
}) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <PrintPage data-testid="page-intro-letter">
      <div className="letter">
        <p className="letter-date">{today}</p>
        <h2 className="sub" style={{ marginTop: 0 }}>
          Dear {lead.property_name} Leadership,
        </h2>
        <p>
          Thank you for the opportunity to present this proposal for landscape management
          services. At Juniper Landscaping, we are committed to delivering exceptional
          results that protect and enhance the value of your property.
        </p>
        <p>
          The enclosed package outlines our comprehensive approach to landscape maintenance,
          our team, our service capabilities, and our commitment to communication and
          accountability. We are confident that Juniper is the right partner for your
          property.
        </p>
        <p>We look forward to the opportunity to serve you.</p>
        <p className="letter-closing">Thank you,</p>
        <SignerBlock signer={signer} />
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 2 — Rooted in Florida (static)
// ---------------------------------------------------------------------------

function RootedInFlorida({ coverage }: { coverage: BranchCoverageGroup[] }) {
  const content = ROOTED_IN_FLORIDA_CONTENT
  const [lede, ...rest] = content.body
  const officeCount = coverage.reduce((n, g) => n + g.branches.length, 0)
  // Same source as the coverage table overleaf, so the two cannot disagree.
  const stats = officeCount
    ? [...COMPANY_STATS, {
        num: String(officeCount),
        label: `Operating locations across ${coverage.length} states`,
      }]
    : COMPANY_STATS
  return (
    <PrintPage data-testid="page-rooted-in-florida">
      <div className="page-head">
        <div>
          <p className="eyebrow">{content.subheading}</p>
          <h1 className="page-title">{content.heading}</h1>
        </div>
        <JuniperLeaves className="head-leaves" />
      </div>
      <p className="lede">{lede}</p>
      <div className="cols-2 wide-left">
        <div>
          {rest.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        <div className="stats">
          {stats.map((s) => (
            <div className="stat" key={s.num}>
              <div className="num">{s.num}</div>
              <div className="lbl">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 3 — Your Local Landscape Experts (static map + variable proximity footer)
// ---------------------------------------------------------------------------

function LocalLandscapeExperts({
  coverage,
  nearbyBranches,
}: {
  coverage: BranchCoverageGroup[]
  nearbyBranches: BranchProfile[]
}) {
  const content = LOCAL_EXPERTS_CONTENT
  return (
    <PrintPage data-testid="page-local-landscape-experts">
      <p className="eyebrow">{content.subheading}</p>
      <h1 className="page-title">{content.heading}</h1>
      <p className="lede">{content.body[0]}</p>

      <div className="cols-2 wide-left branch-cols">
        <table className="branch-tbl" data-testid="branch-coverage">
          <tbody>
            {coverage.map((group) => (
              <Fragment key={group.state}>
                <tr>
                  <th colSpan={2}>{group.stateName}</th>
                </tr>
                {pairUp(group.branches).map(([left, right]) => (
                  <tr key={left}>
                    <td>{left}</td>
                    <td>{right ?? ''}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {/* The Florida branch map artwork is still pending from Proposify. An
            unlabelled tonal block reads as design; a grey box captioned "Florida
            branch map" reads as a missing image in a client-facing document. */}
        <div className="map-pending" />
      </div>

      {/* Variable footer: 2–3 nearest branch offices */}
      {nearbyBranches.length > 0 && (
        <div className="local-branches">
          <h2 className="sub local-branches-title">Local Branches</h2>
          <div className="local-branches-grid" data-testid="nearby-branches">
            {nearbyBranches.map((b) => (
              <div key={b.aspireBranchId} data-testid={`nearby-branch-${b.aspireBranchId}`}>
                <div className="bname">{b.branchName}</div>
                <div className="baddr">{b.address}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PrintPage>
  )
}

/** Two branch names per table row, so a state reads down two short columns. */
function pairUp(items: string[]): [string, string | undefined][] {
  const rows: [string, string | undefined][] = []
  for (let i = 0; i < items.length; i += 2) {
    rows.push([items[i], items[i + 1]])
  }
  return rows
}

// ---------------------------------------------------------------------------
// Page 4 — Org Chart (conditional nodes per §3)
// ---------------------------------------------------------------------------

function CrewRow({ label, count }: { label: string; count: string }) {
  return (
    <div className="org-node org-crew">
      <div className="t">{label}</div>
      <div className="crew-count">{count}</div>
    </div>
  )
}

function OrgNode({ title, name, filled = false }: { title: string; name: string; filled?: boolean }) {
  return (
    <div className={filled ? 'org-node filled' : 'org-node'}>
      <div className="t">{title}</div>
      <div className="n">{name}</div>
    </div>
  )
}

function OrgChartPage({
  orgChart,
  teamMembers,
}: {
  orgChart: OrgChartInput
  teamMembers: TeamMember[]
}) {
  // Build id→member lookup
  const byId = new Map(teamMembers.map((m) => [m.id, m]))

  const accountManagers = orgChart.accountManagerIds
    .map((id) => byId.get(id))
    .filter((m): m is TeamMember => !!m)

  // Optional nodes — omit entirely when null (§8, §3)
  const agronomyManager = orgChart.agronomyManagerId ? byId.get(orgChart.agronomyManagerId) : null
  const irrigationManager = orgChart.irrigationManagerId ? byId.get(orgChart.irrigationManagerId) : null
  const productionManager = orgChart.productionManagerId ? byId.get(orgChart.productionManagerId) : null

  // Regional Director and Branch Manager — first members with those titles
  const rd = teamMembers.find((m) => m.title === 'regional_director') ?? null
  const bm = teamMembers.find((m) => m.title === 'manager') ?? null

  const { mow, prune, fertIpm, irrigation: irrigCrew } = orgChart.crewCounts

  const specialists = [
    agronomyManager && { key: 'agronomy', title: 'Agronomy Manager', name: agronomyManager.name },
    irrigationManager && { key: 'irrigation', title: 'Irrigation Manager', name: irrigationManager.name },
  ].filter((s): s is { key: string; title: string; name: string } => !!s)

  const crews = [
    (mow.foremen > 0 || mow.members > 0) && {
      key: 'mow',
      label: 'Mow Team',
      count: `${mow.foremen} foreman · ${mow.members} members`,
    },
    (prune.foremen > 0 || prune.members > 0) && {
      key: 'prune',
      label: 'Prune Team',
      count: `${prune.foremen} foreman · ${prune.members} members`,
    },
    fertIpm.members > 0 && {
      key: 'fert',
      label: 'Fert/IPM Team',
      count: `${fertIpm.members} members`,
    },
    irrigCrew.members > 0 && {
      key: 'irrig',
      label: 'Irrigation Team',
      count: `${irrigCrew.members} members`,
    },
  ].filter((c): c is { key: string; label: string; count: string } => !!c)

  // Column counts vary with how many people the rep picked, so the grid track
  // list is the one thing here that cannot live in the stylesheet.
  const columns = (n: number) => ({ gridTemplateColumns: `repeat(${n}, 1fr)` })

  return (
    <PrintPage data-testid="page-org-chart">
      <p className="eyebrow">Our Team</p>
      <h1 className="page-title">Your Service Team</h1>

      <div className="org-chart">
        {/* Tier 1: RD */}
        {rd && (
          <>
            <div className="org-solo">
              <OrgNode title="Regional Director" name={rd.name} />
            </div>
            <div className="org-stem" />
          </>
        )}

        {/* Tier 2: BM — the filled node; this is the client's day-to-day owner */}
        {bm && (
          <>
            <div className="org-solo">
              <OrgNode title="Branch Manager" name={bm.name} filled />
            </div>
            <div className="org-stem" />
          </>
        )}

        {/* Tier 3: Account Manager(s) */}
        {accountManagers.length > 0 && (
          <>
            {accountManagers.length > 1 && <div className="org-bar" />}
            <div className="org-row" style={columns(accountManagers.length)}>
              {accountManagers.map((am) => (
                <OrgNode key={am.id} title="Account Manager" name={am.name} />
              ))}
            </div>
            <div className="org-stem" />
          </>
        )}

        {/* Tier 4: Optional specialist managers — only rendered when non-null */}
        {specialists.length > 0 && (
          <>
            {specialists.length > 1 && <div className="org-bar" />}
            <div className="org-row" style={columns(specialists.length)}>
              {specialists.map((s) => (
                <OrgNode key={s.key} title={s.title} name={s.name} />
              ))}
            </div>
            <div className="org-stem" />
          </>
        )}

        {/* Tier 5: Production Manager (deepest named level, per §3) */}
        {productionManager && (
          <>
            <div className="org-solo">
              <OrgNode title="Production Manager" name={productionManager.name} />
            </div>
            <div className="org-stem" />
          </>
        )}

        {/* Tier 6: Numeric crew rows — no names (§3) */}
        {crews.length > 0 && (
          <>
            {crews.length > 1 && <div className="org-bar" />}
            <div className="org-row" style={columns(crews.length)}>
              {crews.map((c) => (
                <CrewRow key={c.key} label={c.label} count={c.count} />
              ))}
            </div>
          </>
        )}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Pages 5–15 — Our Services (11 subpages, one per service key)
// ---------------------------------------------------------------------------

type ServiceKey = keyof typeof SERVICES_CONTENT

const SERVICE_KEYS: ServiceKey[] = [
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
  'services_juniper_cares',
]

function ServicePage({ serviceKey }: { serviceKey: ServiceKey }) {
  const content = SERVICES_CONTENT[serviceKey]
  return (
    <PrintPage data-testid={`page-service-${serviceKey}`}>
      <div className="space-y-4 max-w-prose">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2E7D52]">
            Our Services
          </p>
          <h2 className="text-2xl font-bold text-gray-900 mt-1">{content.title}</h2>
        </div>
        {content.body.map((para, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">
            {para}
          </p>
        ))}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 16 — Start Up Communication (static)
// ---------------------------------------------------------------------------

function StartupCommunication() {
  const content = STARTUP_COMMUNICATION_CONTENT
  return (
    <PrintPage data-testid="page-startup-communication">
      <div className="space-y-4 max-w-prose">
        <h2 className="text-2xl font-bold text-gray-900">{content.heading}</h2>
        {content.body.map((para, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">{para}</p>
        ))}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 17 — Customer Care (static)
// ---------------------------------------------------------------------------

function CustomerCare() {
  const content = CUSTOMER_CARE_CONTENT
  return (
    <PrintPage data-testid="page-customer-care">
      <div className="space-y-4 max-w-prose">
        <h2 className="text-2xl font-bold text-gray-900">{content.heading}</h2>
        {content.body.map((para, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">{para}</p>
        ))}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 18 — Meet Our Team (variable: picked branch members)
// ---------------------------------------------------------------------------

function MeetOurTeam({ members }: { members: TeamMember[] }) {
  return (
    <PrintPage data-testid="page-meet-our-team">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-gray-900">Meet Our Team</h2>
        {members.length === 0 ? (
          <p className="text-sm text-gray-500">No team members selected for this proposal.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {members.map((m) => (
              <TeamMemberCard key={m.id} member={m} />
            ))}
          </div>
        )}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 19 — Client References (variable: picked refs)
// ---------------------------------------------------------------------------

function ClientReferencesPage({ refs }: { refs: ClientReference[] }) {
  return (
    <PrintPage data-testid="page-client-references">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-gray-900">Client References</h2>
        {refs.length === 0 ? (
          <p className="text-sm text-gray-500">No references selected.</p>
        ) : (
          <div className="space-y-4">
            {refs.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-1"
              >
                <p className="font-semibold text-sm text-gray-900">{r.propertyName}</p>
                <p className="text-xs text-[#2E7D52]">{r.servicesProvided}</p>
                <p className="text-xs text-gray-600">Client since {r.clientSinceYear}</p>
                <div className="text-xs text-gray-500 space-y-0.5 pt-1">
                  <p>{r.contactName}{r.contactTitle ? `, ${r.contactTitle}` : ''}</p>
                  <p>{r.phone} · {r.email}</p>
                  <p>{r.address}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 20 — Insurance (static copy + cert object/expiry from config)
// ---------------------------------------------------------------------------

function InsurancePage({
  cert,
}: {
  cert: { id: string; objectKey: string; expiryDate: string; label: string | null } | null
}) {
  const copy = INSURANCE_PAGE_COPY
  return (
    <PrintPage data-testid="page-insurance">
      <div className="space-y-4 max-w-prose">
        <h2 className="text-2xl font-bold text-gray-900">{copy.heading}</h2>
        {copy.intro.map((para, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">{para}</p>
        ))}

        {cert ? (
          <div className="rounded-xl border border-[#2E7D52]/30 bg-[#2E7D52]/5 p-4 space-y-1">
            <p className="text-xs font-semibold text-[#2E7D52]">
              {cert.label ?? 'Certificate of Insurance'}
            </p>
            <p className="text-xs text-gray-600">
              Expires: {new Date(cert.expiryDate).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>
            <p className="text-[11px] text-gray-400 break-all">{cert.objectKey}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs text-gray-400">Certificate pending upload.</p>
          </div>
        )}

        {copy.footer.map((para, i) => (
          <p key={i} className="text-sm text-gray-600 leading-relaxed italic">{para}</p>
        ))}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 21 — Portfolio (variable: picked properties + photos)
// ---------------------------------------------------------------------------

function PortfolioPage({ properties }: { properties: PortfolioProperty[] }) {
  return (
    <PrintPage data-testid="page-portfolio">
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Portfolio</h2>
        {properties.length === 0 ? (
          <p className="text-sm text-gray-500">No portfolio properties selected.</p>
        ) : (
          <div className="space-y-8">
            {properties.map((p) => (
              <div key={p.id} className="space-y-2">
                <p className="font-semibold text-sm text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-500">{p.cityState}</p>
                {p.photoObjectKeys.length > 0 && (
                  <div
                    className={`grid gap-2 ${p.photoObjectKeys.length === 1 ? '' : 'grid-cols-2'}`}
                  >
                    {p.photoObjectKeys.map((key) => (
                      <PortfolioPhoto key={key} objectKey={key} alt={`${p.name} photo`} />
                    ))}
                  </div>
                )}
                {p.beforeAfterObjectKeys && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">Before</p>
                      <PortfolioPhoto
                        objectKey={p.beforeAfterObjectKeys.before}
                        alt={`${p.name} before`}
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">After</p>
                      <PortfolioPhoto
                        objectKey={p.beforeAfterObjectKeys.after}
                        alt={`${p.name} after`}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Page 22 — Thank You (variable signer block, mirrors IntroLetter)
// ---------------------------------------------------------------------------

function ThankYouPage({ signer }: { signer: SignerInfo }) {
  return (
    <PrintPage data-testid="page-thank-you">
      <div className="letter">
        <p className="eyebrow">In closing</p>
        <h1 className="page-title">Thank You</h1>
        <p>
          We appreciate the time you have taken to review this proposal. Juniper Landscaping
          looks forward to the opportunity to become your long-term landscape partner. Our
          team is ready to answer any questions you may have.
        </p>
        <p>
          Please do not hesitate to reach out directly — we would love to schedule a site
          walk to discuss your property's needs in detail.
        </p>
        <p className="letter-closing">Thank you,</p>
        <SignerBlock signer={signer} />
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Optional page: Start Up Plan (30-60-90)
// ---------------------------------------------------------------------------

function StartupPlan306090({ startupPlan }: { startupPlan: StartupPlanInput }) {
  const { dayZero, day30 } = STARTUP_PLAN_SEED

  function BulletSection({ title, bullets }: { title: string; bullets: string[] }) {
    if (bullets.length === 0) return null
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#2E7D52]">{title}</p>
        <ul className="space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-xs text-gray-700">
              <span className="text-[#2E7D52] mt-0.5">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <PrintPage data-testid="page-startup-plan">
      <div className="space-y-5">
        <h2 className="text-2xl font-bold text-gray-900">Start Up Plan (30-60-90 Day)</h2>
        <BulletSection title="Day Zero" bullets={dayZero.map((b) => b.text)} />
        <BulletSection title="Day 30" bullets={day30.map((b) => b.text)} />
        <BulletSection title="Day 60" bullets={startupPlan.day60} />
        <BulletSection title="Day 90" bullets={startupPlan.day90} />
        <BulletSection title="Day 120+" bullets={startupPlan.day120Plus} />
        <BulletSection title="Ongoing" bullets={startupPlan.ongoing} />
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Optional page: Juniper Sync (static)
// ---------------------------------------------------------------------------

function JuniperSyncPage() {
  const content = JUNIPER_SYNC_CONTENT
  return (
    <PrintPage data-testid="page-juniper-sync">
      <div className="space-y-4 max-w-prose">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2E7D52]">
            {content.subheading}
          </p>
          <h2 className="text-2xl font-bold text-gray-900 mt-1">{content.heading}</h2>
        </div>
        {content.body.map((para, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">{para}</p>
        ))}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Optional page: Juniper Mapping (2 pages, static)
// ---------------------------------------------------------------------------

// One component per sheet rather than a fragment of two: the page array in
// ProposalPreview numbers by index, so an entry that renders two sheets would
// silently skip a number.
function JuniperMappingPage({ half }: { half: 'pageOne' | 'pageTwo' }) {
  const content = JUNIPER_MAPPING_CONTENT[half]
  return (
    <PrintPage data-testid={`page-juniper-mapping-${half === 'pageOne' ? 1 : 2}`}>
      <div className="space-y-4 max-w-prose">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#2E7D52]">
            {content.subheading}
          </p>
          <h2 className="text-2xl font-bold text-gray-900 mt-1">{content.heading}</h2>
        </div>
        {content.body.map((para, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">{para}</p>
        ))}
      </div>
    </PrintPage>
  )
}

// ---------------------------------------------------------------------------
// Optional page: Meet Our Team — Executive
// ---------------------------------------------------------------------------

function MeetOurTeamExecutive({ members }: { members: TeamMember[] }) {
  return (
    <PrintPage data-testid="page-meet-our-team-executive">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-gray-900">Meet Our Team — Executive</h2>
        {members.length === 0 ? (
          <p className="text-sm text-gray-500">No executive team members selected.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {members.map((m) => (
              <TeamMemberCard key={m.id} member={m} />
            ))}
          </div>
        )}
      </div>
    </PrintPage>
  )
}

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
}

export function ProposalPreview({
  formState,
  lead,
  onBack,
  proposalId,
  allTeamMembers,
  teamMembers,
  executiveTeamMembers,
  clientReferences,
  portfolioProperties,
}: ProposalPreviewProps) {
  const { branches, branchCoverage, insurance } = useProposalConfig()
  const renderMutation = useRenderProposal()

  // Proximity footer: 2–3 nearest branches to the lead's lat/lng
  const nearbyBranches = nearestBranches(lead.lat, lead.lng, branches, 3)

  // Signer info — currently minimal; the full user-picker is a Slice 9 follow-up.
  // The signer user ID comes from formState; we show what we know.
  const signer: SignerInfo = {
    name: formState.signerUserId ? `Rep (user: ${formState.signerUserId})` : 'Your Juniper Representative',
    title: 'Account Manager',
    phone: COMPANY_INFO.phone,
    email: COMPANY_INFO.email,
    branchAddress: COMPANY_INFO.address,
  }

  const sections = new Set(formState.sections)

  // The document, in §2 order. One entry === one sheet of paper.
  const pages: { key: string; node: React.ReactNode }[] = [
    // Required and implicit, like the intro letter — never in formState.sections.
    { key: 'cover', node: <CoverPage lead={lead} /> },
    { key: 'intro', node: <IntroLetter lead={lead} signer={signer} /> },
    { key: 'rooted', node: <RootedInFlorida coverage={branchCoverage} /> },
    { key: 'local', node: <LocalLandscapeExperts coverage={branchCoverage} nearbyBranches={nearbyBranches} /> },
    ...(formState.orgChart.included
      ? [{
          key: 'org',
          node: <OrgChartPage orgChart={formState.orgChart} teamMembers={allTeamMembers} />,
        }]
      : []),
    ...SERVICE_KEYS.map((key) => ({
      key: `service-${key}`,
      node: <ServicePage serviceKey={key} />,
    })),
    { key: 'startup-comm', node: <StartupCommunication /> },
    { key: 'customer-care', node: <CustomerCare /> },
    { key: 'team', node: <MeetOurTeam members={teamMembers} /> },
    { key: 'references', node: <ClientReferencesPage refs={clientReferences} /> },
    { key: 'insurance', node: <InsurancePage cert={insurance} /> },
    { key: 'portfolio', node: <PortfolioPage properties={portfolioProperties} /> },
    { key: 'thank-you', node: <ThankYouPage signer={signer} /> },

    // Optional pages — present only when their key is in formState.sections.
    ...(sections.has('startup_plan_30_60_90')
      ? [{ key: 'startup-plan', node: <StartupPlan306090 startupPlan={formState.startupPlan} /> }]
      : []),
    ...(sections.has('juniper_sync') ? [{ key: 'sync', node: <JuniperSyncPage /> }] : []),
    ...(sections.has('juniper_mapping')
      ? [
          { key: 'mapping-1', node: <JuniperMappingPage half="pageOne" /> },
          { key: 'mapping-2', node: <JuniperMappingPage half="pageTwo" /> },
        ]
      : []),
    ...(sections.has('meet_our_team_executive')
      ? [{ key: 'team-exec', node: <MeetOurTeamExecutive members={executiveTeamMembers} /> }]
      : []),
  ]

  return (
    <>
      <style>{PRINT_STYLES}</style>

      {/* Action bar — hidden on print */}
      <div className="no-print flex items-center justify-between gap-4 mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to form
        </button>
        <div className="flex items-center gap-2">
          {/* Generate PDF — server-side Chromium render, GCS-persisted */}
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
            className="inline-flex items-center gap-2 rounded-lg bg-[#2E7D52] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {renderMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5" />
            )}
            {renderMutation.isPending ? 'Generating…' : 'Generate PDF'}
          </button>
          {/* Print fallback — opens the chrome-free print route in a new tab and
              prints from there. Printing this page directly fights the AppShell
              layout (fixed-height, clipped) and the visibility lift-out, which
              takes #proposal-preview out of flow so Chrome paginates from the
              viewport height instead of the content height. The print route is
              the exact DOM the server renders, so what you see matches the PDF. */}
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

      {/* All proposal pages */}
      <div
        id="proposal-preview"
        className="proposal-root text-sm rounded-xl border border-[hsl(var(--border))] overflow-hidden print:border-0 print:rounded-none space-y-0"
        data-testid="proposal-preview"
      >
        {/* Each entry is exactly one .print-page — one sheet of paper. The array
            is the page order, and the index is the printed page number, so
            inserting or dropping a page renumbers the rest for free. */}
        {pages.map((page, i) => (
          <PageNumberContext.Provider key={page.key} value={i + 1}>
            {page.node}
          </PageNumberContext.Provider>
        ))}
      </div>
    </>
  )
}
