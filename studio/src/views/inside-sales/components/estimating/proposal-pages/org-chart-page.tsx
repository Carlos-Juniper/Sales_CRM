// ---------------------------------------------------------------------------
// Page 4 — Org Chart (conditional nodes per §3)
// ---------------------------------------------------------------------------

import { Fragment, type ReactNode } from 'react'
import { teamMemberTitleLabel } from '@/lib/proposal/titleLabels'
import type { TeamMember, OrgChartInput } from '@/types/proposal'
import { PrintPage, CrewRow, OrgNode, type SignerInfo } from './shared'

export function OrgChartPage({
  orgChart,
  teamMembers,
  aspireBranchId,
  signer,
}: {
  orgChart: OrgChartInput
  teamMembers: TeamMember[]
  /** The lead's branch — used to prefer a branch-scoped RD/BM over a company-wide row. */
  aspireBranchId?: number | null
  /**
   * Resolved signer — used to synthesise the Account Manager node when the rep
   * is the creator (W3b). When an accountManagerId in the org chart matches
   * SIGNER_SENTINEL, the node is resolved from the signer instead of the roster.
   */
  signer?: SignerInfo
}) {
  // Build id→member lookup
  const byId = new Map(teamMembers.map((m) => [m.id, m]))

  // W3b: resolve each accountManagerId — sentinel IDs fall back to the signer.
  // A sentinel is any ID not present in the roster map (i.e. the rep's own user
  // id was pre-filled by ProposalBuilder but may not have a team_members row).
  const accountManagers = orgChart.accountManagerIds
    .map((id): TeamMember | undefined => {
      const found = byId.get(id)
      if (found) return found
      // Sentinel path: synthesise a minimal TeamMember from the signer facts
      if (signer) {
        return {
          id,
          name: signer.name,
          title: (signer.title ?? 'Account Manager') as TeamMember['title'],
          teamType: 'branch',
          aspireBranchId: null,
          userId: null,
          ownerUserId: null,
          location: null,
          bio: '',
          headshotObjectKey: null,
          active: true,
          sortOrder: 0,
          // Synthesised from the signer, not a roster row, so it has no branch region.
          regionId: null,
        }
      }
      return undefined
    })
    .filter((m): m is TeamMember => !!m)

  // Optional nodes — free-text names, omitted entirely when blank (§8, §3).
  // These roles often have nobody in the roster assigned that title, so unlike
  // the account managers above they are not resolved against team_members.
  const agronomyManagerName = orgChart.agronomyManagerName?.trim() || null
  const irrigationManagerName = orgChart.irrigationManagerName?.trim() || null
  const productionManagerName = orgChart.productionManagerName?.trim() || null

  // Regional Director and Branch Manager — prefer a branch-scoped row when the
  // lead's branch is known; fall back to a company-wide row (aspireBranchId === null).
  // This prevents the company-wide RD from appearing on every branch's proposal.
  function findByTitle(title: TeamMember['title']): TeamMember | null {
    if (aspireBranchId != null) {
      const branchMatch = teamMembers.find(
        (m) => m.title === title && m.aspireBranchId === aspireBranchId,
      )
      if (branchMatch) return branchMatch
    }
    // Fall back to a company-wide row
    return teamMembers.find((m) => m.title === title && m.aspireBranchId === null) ?? null
  }

  const rd = findByTitle('regional_director')
  const bm = findByTitle('manager')

  const { mow, prune, fertIpm, irrigation: irrigCrew } = orgChart.crewCounts

  const specialists = [
    agronomyManagerName && { key: 'agronomy', title: 'Agronomy Manager', name: agronomyManagerName },
    irrigationManagerName && { key: 'irrigation', title: 'Irrigation Manager', name: irrigationManagerName },
  ].filter((s): s is { key: string; title: string; name: string } => !!s)

  // Reference topology (Pointe Jupiter Yacht Club p.5): Account Manager,
  // Agronomy Manager and Irrigation Manager are PEERS under Branch Manager,
  // each heading its own independent branch — not uniform company-wide tiers.
  // The mow/prune/fert-IPM crews report up through Production Manager under
  // Account Manager; the irrigation crew reports up through Irrigation
  // Manager. There's one productionManagerName and one crewCounts per
  // proposal (not one per account manager), so only the first Account
  // Manager's branch carries that chain — additional account managers (rare)
  // render as peers with no branch of their own.
  const amCrews = [
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
  ].filter((c): c is { key: string; label: string; count: string } => !!c)

  const irrigationTeam = irrigCrew.members > 0
    ? { key: 'irrig', label: 'Irrigation Team', count: `${irrigCrew.members} members` }
    : null

  const amBranch = (
    <>
      {productionManagerName && (
        <>
          <div className="org-stem" />
          <OrgNode title="Production Manager" name={productionManagerName} />
        </>
      )}
      {amCrews.map((c) => (
        <Fragment key={c.key}>
          <div className="org-stem" />
          <CrewRow label={c.label} count={c.count} />
        </Fragment>
      ))}
    </>
  )

  const irrigationBranch = irrigationTeam
    ? (
      <>
        <div className="org-stem" />
        <CrewRow label={irrigationTeam.label} count={irrigationTeam.count} />
      </>
    )
    : null

  const peerBranches: { key: string; node: ReactNode; branch: ReactNode }[] = [
    ...accountManagers.map((am, i) => ({
      key: `am-${am.id}`,
      node: <OrgNode key={am.id} title="Account Manager" name={am.name} />,
      branch: i === 0 ? amBranch : null,
    })),
    ...specialists.map((s) => ({
      key: s.key,
      node: <OrgNode key={s.key} title={s.title} name={s.name} />,
      branch: s.key === 'irrigation' ? irrigationBranch : null,
    })),
  ]

  // No Account Manager or specialist to hang Production Manager / the crews
  // off of (unusual — those roles normally imply an Account Manager) — fall
  // back to flat tiers so the data still renders instead of silently
  // disappearing.
  const fallbackCrews = peerBranches.length === 0
    ? [...amCrews, ...(irrigationTeam ? [irrigationTeam] : [])]
    : []

  // Column counts vary with how many people the rep picked, so the grid track
  // list is the one thing here that cannot live in the stylesheet.
  const columns = (n: number) => ({ gridTemplateColumns: `repeat(${n}, 1fr)` })

  return (
    <PrintPage data-testid="page-org-chart">
      <p className="eyebrow">Our Team</p>
      <h1 className="page-title">Community Org Chart</h1>

      <div className="org-chart">
        {/* Tier 1: RD + BM sit side by side as peers (not stacked) — only BM's
            line continues downward, via the elbow below, since AM and every
            tier under it are centered on a single spine that BM's icon (at
            75% of the peers row) doesn't sit on. */}
        {rd && bm ? (
          <>
            <div className="org-peers">
              <OrgNode title={teamMemberTitleLabel(rd.title)} name={rd.name} />
              <OrgNode title={teamMemberTitleLabel(bm.title)} name={bm.name} filled />
            </div>
            <div className="org-elbow" />
          </>
        ) : (
          <>
            {rd && (
              <>
                <div className="org-solo">
                  <OrgNode title={teamMemberTitleLabel(rd.title)} name={rd.name} />
                </div>
                <div className="org-stem" />
              </>
            )}
            {bm && (
              <>
                <div className="org-solo">
                  <OrgNode title={teamMemberTitleLabel(bm.title)} name={bm.name} filled />
                </div>
                <div className="org-stem" />
              </>
            )}
          </>
        )}

        {/* Tiers 3+: Account Manager, Agronomy Manager and Irrigation Manager
            sit as peers under Branch Manager, each heading its own
            independent branch downward (reference: Pointe Jupiter Yacht Club
            p.5) — Production Manager and the mow/prune/fert-IPM crews report
            through Account Manager, the irrigation crew through Irrigation
            Manager, rather than every proposal's roles being flattened into
            uniform company-wide tiers. */}
        {peerBranches.length > 0 && (
          <>
            <div className="org-row" style={columns(peerBranches.length)}>
              {peerBranches.map((p) => p.node)}
            </div>
            <div className="org-branches" style={columns(peerBranches.length)}>
              {peerBranches.map((p) => (
                <div className="org-branch" key={p.key}>
                  {p.branch}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Fallback: no Account Manager or specialist present to hang
            Production Manager / the crews off of — render the old flat
            tiers so the data isn't silently dropped. */}
        {peerBranches.length === 0 && productionManagerName && (
          <>
            <div className="org-solo">
              <OrgNode title="Production Manager" name={productionManagerName} />
            </div>
            <div className="org-stem" />
          </>
        )}
        {peerBranches.length === 0 && fallbackCrews.length > 0 && (
          <div className="org-row" style={columns(fallbackCrews.length)}>
            {fallbackCrews.map((c) => (
              <CrewRow key={c.key} label={c.label} count={c.count} />
            ))}
          </div>
        )}
      </div>
    </PrintPage>
  )
}
