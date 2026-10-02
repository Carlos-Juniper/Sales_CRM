import { useState } from 'react'
import { useApprovalTiers, useUpdateApprovalTier } from '@/hooks/useCompanySettings'
import { groupApprovalTiersByRole } from '@/lib/estimating/approvalOrder'
import { ROLE_LABELS } from '@/lib/roleLabels'
import type { ApprovalTier } from '@/types/estimating'
import { FormStatus, SettingsFormShell } from './formStatus'
import { SaveButton } from './SlaForm'

function tierLabel(tier: ApprovalTier): string {
  const label = tier.label.trim()
  return label || ROLE_LABELS[tier.roleKey]
}

/** Cents → whole/decimal dollars for the input value ('' when unbounded). */
function centsToDollars(cents: number | null): string {
  return cents === null ? '' : String(cents / 100)
}
/** Dollars string → integer cents. */
function dollarsToCents(dollars: string): number {
  return Math.round(Number(dollars) * 100)
}

/**
 * Approval-tier ladder: the DB stores TWO rows per role (one per estimateType
 * — maintenance and install) that must stay in sync. The UI shows ONE card per
 * role and PATCHes BOTH tier ids so the two ladders remain mirrored.
 *
 * Company-scoped per §2.4 — editing a ceiling moves the real approval 403
 * boundary, so it's admin-owned.
 */
export function ApprovalTiersForm() {
  const { data, isLoading, isError } = useApprovalTiers()

  if (isLoading) {
    return (
      <SettingsFormShell slug="approval-tiers" title="Approval tiers">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError || !data) {
    return (
      <SettingsFormShell slug="approval-tiers" title="Approval tiers">
        <p role="alert" className="text-xs text-red-600">
          Could not load approval tiers.
        </p>
      </SettingsFormShell>
    )
  }

  const groups = groupApprovalTiersByRole(data)

  return (
    <SettingsFormShell
      slug="approval-tiers"
      title="Approval tiers"
      description="Editing a ceiling moves the real approval boundary. Amounts in dollars."
    >
      <ul className="space-y-4">
        {groups.map((tiers) => (
          <li key={tiers[0].roleKey}>
            <TierRow tiers={tiers} />
          </li>
        ))}
      </ul>
    </SettingsFormShell>
  )
}

/**
 * A single role card. Accepts ALL tier rows for that role (maintenance +
 * install) so it can PATCH every id when the ceiling changes — keeping both
 * ladders in sync without a second round-trip.
 */
function TierRow({ tiers }: { tiers: ApprovalTier[] }) {
  // All tiers in a role group share the same ceiling (mirrored), so read from
  // the first row. The label is also shared.
  const representative = tiers[0]
  const label = tierLabel(representative)
  const [ceiling, setCeiling] = useState(centsToDollars(representative.maxValueCents))
  const update = useUpdateApprovalTier()

  const inputId = `tier-ceiling-${representative.roleKey}`
  const unbounded = ceiling.trim() === ''

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Blank keeps an unbounded ceiling (admin, vp_sales, and the top band).
    // A typed amount writes that ceiling, including onto a row that was null.
    if (unbounded) return
    const nextCents = dollarsToCents(ceiling)
    if (tiers.every((t) => t.maxValueCents === nextCents)) return

    // PATCH every tier id for this role so maintenance and install stay mirrored.
    for (const tier of tiers) {
      update.mutate({ tierId: tier.id, body: { max_value_cents: nextCents } })
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-[var(--border)] p-3">
      <p className="text-sm font-medium text-[var(--fg)]">{label}</p>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[8rem]">
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-[var(--fg)] opacity-70 mb-1"
          >
            {label} ceiling ($)
          </label>
          <input
            id={inputId}
            type="number"
            min={0}
            step={1}
            value={ceiling}
            placeholder={representative.maxValueCents === null ? 'No ceiling' : undefined}
            onChange={(e) => setCeiling(e.target.value)}
            className="w-full max-w-[10rem] rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
          />
        </div>
        <SaveButton pending={update.isPending}>Save {label}</SaveButton>
      </div>
      <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
    </form>
  )
}
