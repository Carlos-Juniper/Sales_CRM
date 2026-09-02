// ---------------------------------------------------------------------------
// ProposalBuilder — two-step container (Form → Preview) for generating a
// Juniper sales proposal from an approved Lead + approved Estimate.
//
// Step 1 (Form):  optional-section toggles, org chart inputs, team/reference/
//                 portfolio multi-pickers, 30-60-90 free-text rows, signer
//                 picker → calls useCreateProposal / useUpdateProposal.
// Step 2 (Preview): Slice 8 drops its page sub-components into <PreviewSlot />.
//                   Until Slice 8 ships, a placeholder is rendered.
//
// Branch-scoping: the Estimate carries aspireBranchId (Slice 8), captured at
// intake from the selected branch. The team/client-reference pickers scope by
// that id; legacy rows with a null id fall back to all active branch members.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  useTeamMembers,
  useClientReferences,
  usePortfolio,
  useProposal,
  useCreateProposal,
  useUpdateProposal,
} from '@/hooks/useProposals'
import { ProposalPreview } from './ProposalPreview'
import type { Lead } from '@/types'
import type { Estimate } from '@/types/estimating'
import type {
  OrgChartInput,
  OrgChartCrewCounts,
  ProposalSectionKey,
  StartupPlanInput,
  TeamMember,
  ClientReference,
  PortfolioProperty,
} from '@/types/proposal'

// ---------------------------------------------------------------------------
// Exported form-state shape (Slice 8 Preview consumes the same object)
// ---------------------------------------------------------------------------

/** The four optional ProposalSectionKeys the rep can toggle on the form. */
export type OptionalSection =
  | 'startup_plan_30_60_90'
  | 'juniper_sync'
  | 'juniper_mapping'
  | 'meet_our_team_executive'

/** Mirrors ProposalRequest's mutable fields. Slice 8 receives this as a prop. */
export interface ProposalFormState {
  /** Which optional sections are included (required pages are always present). */
  sections: OptionalSection[]
  orgChart: OrgChartInput
  startupPlan: StartupPlanInput
  /** Meet Our Team picks (page 8) — branch-scoped team members. */
  teamMemberIds: string[]
  /** Optional Meet Our Team — Executive team members. */
  executiveTeamMemberIds: string[]
  clientReferenceIds: string[]
  portfolioPropertyIds: string[]
  /** User id of the rep who signs the intro letter and thank-you pages. */
  signerUserId: string
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProposalBuilderProps {
  /** The approved Lead. Caller guarantees lead.status === 'approved'. */
  lead: Lead
  /** The approved Estimate for this lead. Caller guarantees estimate.status === 'approved'. */
  estimate: Estimate
  /**
   * When provided, reopens an existing proposal for editing.
   * The form hydrates from the saved ProposalRequest via useProposal(proposalId).
   */
  proposalId?: string | null
  /** Called when the user dismisses/closes the builder. */
  onClose?: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPTIONAL_SECTIONS: { key: OptionalSection; label: string }[] = [
  { key: 'startup_plan_30_60_90', label: 'Start Up Plan (30-60-90 Day)' },
  { key: 'juniper_sync', label: 'Juniper Sync' },
  { key: 'juniper_mapping', label: 'Juniper Mapping (2 pages)' },
  { key: 'meet_our_team_executive', label: 'Meet Our Team — Executive' },
]

function makeDefaultCrewCounts(): OrgChartCrewCounts {
  return {
    mow: { foremen: 0, members: 0 },
    prune: { foremen: 0, members: 0 },
    fertIpm: { members: 0 },
    irrigation: { members: 0 },
  }
}

function makeDefaultFormState(signerUserId: string): ProposalFormState {
  return {
    sections: [],
    orgChart: {
      included: false,
      accountManagerIds: [],
      agronomyManagerId: null,
      irrigationManagerId: null,
      productionManagerId: null,
      crewCounts: makeDefaultCrewCounts(),
    },
    startupPlan: {
      included: false,
      day60: [],
      day90: [],
      day120Plus: [],
      ongoing: [],
    },
    teamMemberIds: [],
    executiveTeamMemberIds: [],
    clientReferenceIds: [],
    portfolioPropertyIds: [],
    signerUserId,
  }
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

/** Multi-select list with checkboxes. */
function MultiSelect<T extends { id: string }>({
  items,
  selected,
  renderLabel,
  onChange,
  'data-testid': testId,
}: {
  items: T[]
  selected: string[]
  renderLabel: (item: T) => string
  onChange: (ids: string[]) => void
  'data-testid'?: string
}) {
  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }
  if (items.length === 0) {
    return <p className="text-[11px] text-[hsl(var(--muted-fg))]">No items available.</p>
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      {items.map((item) => (
        <label key={item.id} className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={selected.includes(item.id)}
            onChange={() => toggle(item.id)}
            className="h-3.5 w-3.5 accent-[#2E7D52]"
          />
          <span className="text-xs text-[hsl(var(--fg))]">{renderLabel(item)}</span>
        </label>
      ))}
    </div>
  )
}

/** Single-select dropdown from a list of team members. */
function SingleTeamPicker({
  label,
  members,
  value,
  onChange,
  'data-testid': testId,
}: {
  label: string
  members: TeamMember[]
  value: string | null | undefined
  onChange: (id: string | null) => void
  'data-testid'?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-[hsl(var(--muted-fg))]">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]"
        data-testid={testId}
      >
        <option value="">— None —</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Numeric crew-count input. */
function CrewCountInput({
  label,
  value,
  onChange,
  'data-testid': testId,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  'data-testid'?: string
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[11px] text-[hsl(var(--muted-fg))]">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
        className="h-7 w-20 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]"
        data-testid={testId}
      />
    </div>
  )
}

/** Dynamic bullet list (add/remove rows). */
function BulletListInput({
  label,
  items,
  onChange,
  placeholder,
  'data-testid': testId,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  'data-testid'?: string
}) {
  function updateItem(i: number, val: string) {
    const next = [...items]
    next[i] = val
    onChange(next)
  }
  function addItem() {
    onChange([...items, ''])
  }
  function removeItem(i: number) {
    onChange(items.filter((_, idx) => idx !== i))
  }
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <p className="text-[11px] font-medium text-[hsl(var(--fg))]">{label}</p>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={item}
            onChange={(e) => updateItem(i, e.target.value)}
            placeholder={placeholder ?? 'Enter bullet point'}
            className="h-7 flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]"
          />
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]"
            aria-label={`Remove ${label} item ${i + 1}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="text-[11px] font-medium text-[#2E7D52] hover:underline"
      >
        + Add bullet
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ step }: { step: 'form' | 'preview' }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
          step === 'form'
            ? 'bg-[#2E7D52] text-white'
            : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-fg))]',
        )}
      >
        1
      </span>
      <span className={step === 'form' ? 'font-semibold text-[hsl(var(--fg))]' : 'text-[hsl(var(--muted-fg))]'}>
        Configure
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--muted-fg))]" />
      <span
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
          step === 'preview'
            ? 'bg-[#2E7D52] text-white'
            : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-fg))]',
        )}
      >
        2
      </span>
      <span className={step === 'preview' ? 'font-semibold text-[hsl(var(--fg))]' : 'text-[hsl(var(--muted-fg))]'}>
        Preview &amp; Export
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder for Slice 8 Preview pages
// ---------------------------------------------------------------------------

/**
 * Slice 8 satisfies this interface with the full ProposalPreview component.
 */
export interface ProposalPreviewSlotProps {
  formState: ProposalFormState
  lead: Lead
  estimate: Estimate
  onBack: () => void
  /** The saved proposal id — null when the proposal has not yet been persisted. */
  proposalId?: string | null
}

// ---------------------------------------------------------------------------
// Form step
// ---------------------------------------------------------------------------

function ProposalFormStep({
  lead,
  estimate,
  formState,
  onFormChange,
  onSubmit,
  submitting,
  submitError,
  isEditing,
}: {
  lead: Lead
  estimate: Estimate
  formState: ProposalFormState
  onFormChange: (patch: Partial<ProposalFormState>) => void
  onSubmit: () => void
  submitting: boolean
  submitError: string | null
  isEditing: boolean
}) {
  // ---------------------------------------------------------------------------
  // Branch scoping: the estimate now carries aspireBranchId (Slice 8), captured
  // at intake from the selected branch. Scope the team/client-reference pickers
  // to that branch; legacy rows with a null id fall back to all active members.
  // ---------------------------------------------------------------------------
  const aspireBranchId: number | undefined = estimate.aspireBranchId ?? undefined

  const { data: branchTeamMembers = [] } = useTeamMembers(
    aspireBranchId !== undefined ? { aspireBranchId } : undefined,
  )
  const { data: executiveMembers = [] } = useTeamMembers({ teamType: 'executive' })
  const { data: clientRefs = [] } = useClientReferences(
    aspireBranchId !== undefined ? { aspireBranchId } : undefined,
  )
  const { data: portfolio = [] } = usePortfolio()

  // Derived filtered views for org chart pickers (branch-type members only)
  const accountManagers = branchTeamMembers.filter((m) => m.title === 'account_manager')
  const agronomyManagers = branchTeamMembers.filter((m) => m.title === 'agronomy_manager')
  const irrigationManagers = branchTeamMembers.filter((m) => m.title === 'irrigation_manager')
  const productionManagers = branchTeamMembers.filter((m) => m.title === 'production_manager')

  const startupPlanChecked = formState.sections.includes('startup_plan_30_60_90')
  const executiveTeamChecked = formState.sections.includes('meet_our_team_executive')

  function toggleSection(key: OptionalSection) {
    const current = formState.sections
    if (current.includes(key)) {
      onFormChange({ sections: current.filter((s) => s !== key) })
    } else {
      onFormChange({ sections: [...current, key] })
    }
  }

  function patchOrgChart(patch: Partial<OrgChartInput>) {
    onFormChange({ orgChart: { ...formState.orgChart, ...patch } })
  }

  function patchCrewCounts(patch: Partial<OrgChartCrewCounts>) {
    patchOrgChart({ crewCounts: { ...formState.orgChart.crewCounts, ...patch } })
  }

  function patchStartupPlan(patch: Partial<StartupPlanInput>) {
    onFormChange({ startupPlan: { ...formState.startupPlan, ...patch } })
  }

  // Account manager multi-select: toggle an id in/out of accountManagerIds
  function toggleAccountManager(id: string) {
    const ids = formState.orgChart.accountManagerIds
    patchOrgChart({
      accountManagerIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="flex max-w-[760px] flex-col gap-5"
      aria-label="Proposal configuration form"
    >
      {/* Lead / estimate summary */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3.5">
        <p className="text-[13px] font-semibold text-[hsl(var(--fg))]">{lead.property_name}</p>
        <p className="text-xs text-[hsl(var(--muted-fg))]">
          {estimate.estimateType === 'maintenance' ? 'Maintenance' : 'Installation'} •{' '}
          {(estimate.contractValueCents / 100).toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0,
          })}
        </p>
      </div>

      {/* Optional sections */}
      <section aria-labelledby="optional-sections-heading">
        <h3
          id="optional-sections-heading"
          className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]"
        >
          Optional sections
        </h3>
        <p className="mb-2 text-[11px] text-[hsl(var(--muted-fg))]">
          The 12 required pages are always included. Check any optional pages to add them.
        </p>
        <div className="flex flex-col gap-2" data-testid="optional-sections">
          {OPTIONAL_SECTIONS.map(({ key, label }) => (
            <label key={key} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={formState.sections.includes(key)}
                onChange={() => toggleSection(key)}
                className="h-3.5 w-3.5 accent-[#2E7D52]"
                data-testid={`section-checkbox-${key}`}
              />
              <span className="text-xs text-[hsl(var(--fg))]">{label}</span>
            </label>
          ))}
        </div>
      </section>

      {/* 30-60-90 free-text rows — visible only when startup_plan_30_60_90 is checked */}
      {startupPlanChecked && (
        <section
          aria-labelledby="startup-plan-heading"
          data-testid="startup-plan-section"
          className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
        >
          <h3
            id="startup-plan-heading"
            className="mb-3 text-[13px] font-semibold text-[hsl(var(--fg))]"
          >
            Start Up Plan — free-text entries
          </h3>
          <p className="mb-3 text-[11px] text-[hsl(var(--muted-fg))]">
            Day Zero and Day 30 are static. Fill in Day 60, 90, 120+, and Ongoing below.
          </p>
          <div className="flex flex-col gap-4">
            <BulletListInput
              label="Day 60"
              items={formState.startupPlan.day60}
              onChange={(day60) => patchStartupPlan({ day60 })}
              data-testid="startup-day60"
            />
            <BulletListInput
              label="Day 90"
              items={formState.startupPlan.day90}
              onChange={(day90) => patchStartupPlan({ day90 })}
              data-testid="startup-day90"
            />
            <BulletListInput
              label="Day 120+"
              items={formState.startupPlan.day120Plus}
              onChange={(day120Plus) => patchStartupPlan({ day120Plus })}
              data-testid="startup-day120plus"
            />
            <BulletListInput
              label="Ongoing"
              items={formState.startupPlan.ongoing}
              onChange={(ongoing) => patchStartupPlan({ ongoing })}
              data-testid="startup-ongoing"
            />
          </div>
        </section>
      )}

      {/* Org chart */}
      <section
        aria-labelledby="org-chart-heading"
        className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
      >
        <h3
          id="org-chart-heading"
          className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]"
        >
          Org chart
        </h3>
        <label className="mb-3 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={formState.orgChart.included}
            onChange={(e) => patchOrgChart({ included: e.target.checked })}
            className="h-3.5 w-3.5 accent-[#2E7D52]"
            data-testid="org-chart-toggle"
          />
          <span className="text-xs text-[hsl(var(--fg))]">Include org chart in proposal</span>
        </label>

        {formState.orgChart.included && (
          <div className="flex flex-col gap-4" data-testid="org-chart-inputs">
            {/* Account Managers — multi-select */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-[hsl(var(--fg))]">
                Account Manager(s) <span className="text-[#c0392b]">*</span>
              </p>
              {accountManagers.length === 0 ? (
                <p className="text-[11px] text-[hsl(var(--muted-fg))]">
                  No account managers available for this branch.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5" data-testid="account-manager-list">
                  {accountManagers.map((m) => (
                    <label key={m.id} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formState.orgChart.accountManagerIds.includes(m.id)}
                        onChange={() => toggleAccountManager(m.id)}
                        className="h-3.5 w-3.5 accent-[#2E7D52]"
                        data-testid={`am-checkbox-${m.id}`}
                      />
                      <span className="text-xs text-[hsl(var(--fg))]">{m.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Optional single-picks */}
            <SingleTeamPicker
              label="Agronomy Manager (optional)"
              members={agronomyManagers}
              value={formState.orgChart.agronomyManagerId}
              onChange={(id) => patchOrgChart({ agronomyManagerId: id })}
              data-testid="agronomy-manager-picker"
            />
            <SingleTeamPicker
              label="Irrigation Manager (optional)"
              members={irrigationManagers}
              value={formState.orgChart.irrigationManagerId}
              onChange={(id) => patchOrgChart({ irrigationManagerId: id })}
              data-testid="irrigation-manager-picker"
            />
            <SingleTeamPicker
              label="Production Manager (optional)"
              members={productionManagers}
              value={formState.orgChart.productionManagerId}
              onChange={(id) => patchOrgChart({ productionManagerId: id })}
              data-testid="production-manager-picker"
            />

            {/* Crew counts */}
            <div>
              <p className="mb-2 text-xs font-medium text-[hsl(var(--fg))]">Crew counts</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <CrewCountInput
                  label="Mow — foremen"
                  value={formState.orgChart.crewCounts.mow.foremen}
                  onChange={(n) =>
                    patchCrewCounts({ mow: { ...formState.orgChart.crewCounts.mow, foremen: n } })
                  }
                  data-testid="crew-mow-foremen"
                />
                <CrewCountInput
                  label="Mow — members"
                  value={formState.orgChart.crewCounts.mow.members}
                  onChange={(n) =>
                    patchCrewCounts({ mow: { ...formState.orgChart.crewCounts.mow, members: n } })
                  }
                  data-testid="crew-mow-members"
                />
                <CrewCountInput
                  label="Prune — foremen"
                  value={formState.orgChart.crewCounts.prune.foremen}
                  onChange={(n) =>
                    patchCrewCounts({
                      prune: { ...formState.orgChart.crewCounts.prune, foremen: n },
                    })
                  }
                  data-testid="crew-prune-foremen"
                />
                <CrewCountInput
                  label="Prune — members"
                  value={formState.orgChart.crewCounts.prune.members}
                  onChange={(n) =>
                    patchCrewCounts({
                      prune: { ...formState.orgChart.crewCounts.prune, members: n },
                    })
                  }
                  data-testid="crew-prune-members"
                />
                <CrewCountInput
                  label="Fert/IPM — members"
                  value={formState.orgChart.crewCounts.fertIpm.members}
                  onChange={(n) => patchCrewCounts({ fertIpm: { members: n } })}
                  data-testid="crew-fertipm-members"
                />
                <CrewCountInput
                  label="Irrigation — members"
                  value={formState.orgChart.crewCounts.irrigation.members}
                  onChange={(n) => patchCrewCounts({ irrigation: { members: n } })}
                  data-testid="crew-irrigation-members"
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Meet Our Team picks */}
      <section
        aria-labelledby="team-heading"
        className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
      >
        <h3
          id="team-heading"
          className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]"
        >
          Meet Our Team (page 8)
        </h3>
        <MultiSelect<TeamMember>
          items={branchTeamMembers.filter((m) => m.teamType === 'branch')}
          selected={formState.teamMemberIds}
          renderLabel={(m) => `${m.name} — ${m.title.replace(/_/g, ' ')}`}
          onChange={(teamMemberIds) => onFormChange({ teamMemberIds })}
          data-testid="team-member-picker"
        />
      </section>

      {/* Executive team picks — shown only when that optional section is checked */}
      {executiveTeamChecked && (
        <section
          aria-labelledby="executive-team-heading"
          data-testid="executive-team-section"
          className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
        >
          <h3
            id="executive-team-heading"
            className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]"
          >
            Meet Our Team — Executive
          </h3>
          <MultiSelect<TeamMember>
            items={executiveMembers}
            selected={formState.executiveTeamMemberIds}
            renderLabel={(m) => `${m.name} — ${m.title.replace(/_/g, ' ')}`}
            onChange={(executiveTeamMemberIds) => onFormChange({ executiveTeamMemberIds })}
            data-testid="executive-team-picker"
          />
        </section>
      )}

      {/* Client references */}
      <section
        aria-labelledby="refs-heading"
        className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
      >
        <h3
          id="refs-heading"
          className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]"
        >
          Client references (page 9)
        </h3>
        <MultiSelect<ClientReference>
          items={clientRefs}
          selected={formState.clientReferenceIds}
          renderLabel={(r) => `${r.propertyName} (${r.clientSinceYear})`}
          onChange={(clientReferenceIds) => onFormChange({ clientReferenceIds })}
          data-testid="client-reference-picker"
        />
      </section>

      {/* Portfolio */}
      <section
        aria-labelledby="portfolio-heading"
        className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
      >
        <h3
          id="portfolio-heading"
          className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]"
        >
          Portfolio properties (page 11)
        </h3>
        <MultiSelect<PortfolioProperty>
          items={portfolio}
          selected={formState.portfolioPropertyIds}
          renderLabel={(p) => `${p.name} — ${p.cityState}`}
          onChange={(portfolioPropertyIds) => onFormChange({ portfolioPropertyIds })}
          data-testid="portfolio-picker"
        />
      </section>

      {/* Signer */}
      <section
        aria-labelledby="signer-heading"
        className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
      >
        <h3
          id="signer-heading"
          className="mb-2.5 text-[13px] font-semibold text-[hsl(var(--fg))]"
        >
          Signer
        </h3>
        <p className="mb-2 text-[11px] text-[hsl(var(--muted-fg))]">
          This person's name and contact info appear on the intro letter and thank-you page.
        </p>
        {/* For now the signer is pre-set to the logged-in user. Slice 9 / BidTab
            may add a full user picker here if Sales needs to designate someone else. */}
        <p className="text-xs text-[hsl(var(--fg))]" data-testid="signer-display">
          Signer user ID: <span className="font-mono">{formState.signerUserId}</span>
        </p>
      </section>

      {submitError && (
        <p role="alert" className="text-xs text-[#c0392b]">
          {submitError}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2E7D52] px-5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="submit-proposal"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEditing ? 'Save changes' : 'Generate proposal'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// ProposalBuilder (container)
// ---------------------------------------------------------------------------

export function ProposalBuilder({ lead, estimate, proposalId, onClose }: ProposalBuilderProps) {
  const user = useAuthStore((s) => s.user)
  const signerUserId = user?.id ?? ''

  const [step, setStep] = useState<'form' | 'preview'>('form')
  const [formState, setFormState] = useState<ProposalFormState>(() =>
    makeDefaultFormState(signerUserId),
  )
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Pre-fetch config data needed by the Preview step. These are already
  // cached if ProposalFormStep already called the same hooks.
  const { data: allBranchTeamMembers = [] } = useTeamMembers()
  const { data: allClientRefs = [] } = useClientReferences()
  const { data: allPortfolio = [] } = usePortfolio()
  const { data: executiveMembersData = [] } = useTeamMembers({ teamType: 'executive' })

  // Reopen flow: load an existing proposal and hydrate the form.
  const { data: savedProposal, isLoading: loadingProposal } = useProposal(proposalId ?? null)

  useEffect(() => {
    if (!savedProposal) return
    // Hydrate from the saved ProposalRequest — only the four optional sections
    // are togglable, so filter the sections array to just those.
    const optionalKeys = OPTIONAL_SECTIONS.map((s) => s.key)
    setFormState({
      sections: savedProposal.sections.filter((s): s is OptionalSection =>
        optionalKeys.includes(s as OptionalSection),
      ),
      orgChart: savedProposal.orgChart,
      startupPlan: savedProposal.startupPlan,
      teamMemberIds: savedProposal.teamMemberIds,
      executiveTeamMemberIds: savedProposal.executiveTeamMemberIds,
      clientReferenceIds: savedProposal.clientReferenceIds,
      portfolioPropertyIds: savedProposal.portfolioPropertyIds,
      signerUserId: savedProposal.signerUserId,
    })
  }, [savedProposal])

  const createMutation = useCreateProposal()
  const updateMutation = useUpdateProposal()

  const submitting = createMutation.isPending || updateMutation.isPending
  const isEditing = !!proposalId && !!savedProposal

  const handleFormChange = useCallback((patch: Partial<ProposalFormState>) => {
    setFormState((prev) => ({ ...prev, ...patch }))
  }, [])

  function buildPayload() {
    // The required pages are always present; only the form's optional selections
    // are stored in `sections` (the backend / Slice 8 knows which pages are required).
    return {
      leadId: lead.id,
      estimateId: estimate.id,
      createdBy: signerUserId,
      sections: formState.sections as ProposalSectionKey[],
      orgChart: formState.orgChart,
      startupPlan: {
        ...formState.startupPlan,
        included: formState.sections.includes('startup_plan_30_60_90'),
      },
      teamMemberIds: formState.teamMemberIds,
      executiveTeamMemberIds: formState.executiveTeamMemberIds,
      clientReferenceIds: formState.clientReferenceIds,
      portfolioPropertyIds: formState.portfolioPropertyIds,
      signerUserId: formState.signerUserId,
    }
  }

  async function handleSubmit() {
    setSubmitError(null)
    try {
      if (isEditing && proposalId) {
        await updateMutation.mutateAsync({ id: proposalId, patch: buildPayload() })
      } else {
        await createMutation.mutateAsync(buildPayload())
      }
      setStep('preview')
    } catch {
      setSubmitError('Failed to save proposal. Please try again.')
    }
  }

  if (loadingProposal) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-fg))]" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[hsl(var(--fg))]">
            {isEditing ? 'Edit proposal' : 'Generate proposal'}
          </h2>
          <p className="mt-0.5 text-xs text-[hsl(var(--muted-fg))]">
            {lead.property_name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StepIndicator step={step} />
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close proposal builder"
              className="rounded-md p-1.5 text-[hsl(var(--muted-fg))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--fg))]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {step === 'form' ? (
        <ProposalFormStep
          lead={lead}
          estimate={estimate}
          formState={formState}
          onFormChange={handleFormChange}
          onSubmit={handleSubmit}
          submitting={submitting}
          submitError={submitError}
          isEditing={isEditing}
        />
      ) : (
        // ProposalPreview (Slice 8) renders all 12+ pages print-ready.
        // Resolved data is passed from container-level hooks (already cached from
        // ProposalFormStep). allTeamMembers is the unfiltered list for org-chart
        // node resolution; teamMembers/executiveTeamMembers/refs/portfolio are
        // filtered to the picked IDs.
        <ProposalPreview
          formState={formState}
          lead={lead}
          estimate={estimate}
          onBack={() => setStep('form')}
          proposalId={proposalId ?? createMutation.data?.id ?? null}
          allTeamMembers={allBranchTeamMembers}
          teamMembers={allBranchTeamMembers.filter((m) =>
            formState.teamMemberIds.includes(m.id),
          )}
          executiveTeamMembers={executiveMembersData.filter((m) =>
            formState.executiveTeamMemberIds.includes(m.id),
          )}
          clientReferences={allClientRefs.filter((r) =>
            formState.clientReferenceIds.includes(r.id),
          )}
          portfolioProperties={allPortfolio.filter((p) =>
            formState.portfolioPropertyIds.includes(p.id),
          )}
        />
      )}
    </div>
  )
}
