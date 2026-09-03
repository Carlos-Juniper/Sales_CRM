import { useState } from 'react'
import { useApprovalTiers, useUpdateApprovalTier } from '@/hooks/useCompanySettings'
import type { ApprovalTier } from '@/types/estimating'
import { FormStatus, SettingsFormShell } from './formStatus'
import { SaveButton } from './SlaForm'

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

  // Group by roleKey: each group contains all rows for that role (maintenance +
  // install). Preserve insertion order — the API returns rows sorted by `order`.
  const byRole = new Map<string, ApprovalTier[]>()
  for (const tier of data) {
    const group = byRole.get(tier.roleKey) ?? []
    group.push(tier)
    byRole.set(tier.roleKey, group)
  }

  return (
    <SettingsFormShell
      slug="approval-tiers"
      title="Approval tiers"
      description="Editing a ceiling moves the real approval boundary. Amounts in dollars."
    >
      <ul className="space-y-4">
        {Array.from(byRole.values()).map((tiers) => (
          // Use the first tier's id as the key — stable since there are exactly
          // 2 rows per role and both share the same roleKey.
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
  const [ceiling, setCeiling] = useState(centsToDollars(representative.maxValueCents))
  const update = useUpdateApprovalTier()

  const inputId = `tier-ceiling-${representative.roleKey}`
  const unbounded = ceiling.trim() === ''

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (unbounded) return // unbounded (top) tier has no ceiling to write
    const nextCents = dollarsToCents(ceiling)
    // Skip if all rows already have this value.
    if (tiers.every((t) => t.maxValueCents === nextCents)) return

    // PATCH every tier id for this role so maintenance and install stay mirrored.
    for (const tier of tiers) {
      update.mutate({ tierId: tier.id, body: { max_value_cents: nextCents } })
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-[var(--border)] p-3">
      <p className="text-sm font-medium text-[var(--fg)]">{representative.label}</p>
      <div className="mt-2 flex items-end gap-3">
        <div>
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-[var(--fg)] opacity-70 mb-1"
          >
            {representative.label} ceiling ($)
          </label>
          <input
            id={inputId}
            type="number"
            min={0}
            step={1}
            value={ceiling}
            placeholder={representative.maxValueCents === null ? 'No ceiling' : undefined}
            onChange={(e) => setCeiling(e.target.value)}
            className="w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
          />
        </div>
        <SaveButton pending={update.isPending}>Save {representative.label}</SaveButton>
      </div>
      <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
    </form>
  )
}
