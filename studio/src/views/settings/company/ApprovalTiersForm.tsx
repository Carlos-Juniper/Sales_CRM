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
 * Approval-tier ladder: each row's ceiling (max_value_cents) is editable in
 * dollars and PATCHes /company/approval-tiers/{id}. Company-scoped per §2.4 —
 * editing a ceiling moves the real approval 403 boundary, so it's admin-owned.
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

  return (
    <SettingsFormShell
      slug="approval-tiers"
      title="Approval tiers"
      description="Editing a ceiling moves the real approval boundary. Amounts in dollars."
    >
      <ul className="space-y-4">
        {data.map((tier) => (
          <li key={tier.id}>
            <TierRow tier={tier} />
          </li>
        ))}
      </ul>
    </SettingsFormShell>
  )
}

function TierRow({ tier }: { tier: ApprovalTier }) {
  const [ceiling, setCeiling] = useState(centsToDollars(tier.maxValueCents))
  const update = useUpdateApprovalTier()

  const inputId = `tier-ceiling-${tier.id}`
  const unbounded = ceiling.trim() === ''

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (unbounded) return // an unbounded (top) tier has no ceiling to write
    const nextCents = dollarsToCents(ceiling)
    if (nextCents === tier.maxValueCents) return
    update.mutate({ tierId: tier.id, body: { max_value_cents: nextCents } })
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-[var(--border)] p-3">
      <p className="text-sm font-medium text-[var(--fg)]">{tier.label}</p>
      <div className="mt-2 flex items-end gap-3">
        <div>
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-[var(--fg)] opacity-70 mb-1"
          >
            {tier.label} ceiling ($)
          </label>
          <input
            id={inputId}
            type="number"
            min={0}
            step={1}
            value={ceiling}
            placeholder={tier.maxValueCents === null ? 'No ceiling' : undefined}
            onChange={(e) => setCeiling(e.target.value)}
            className="w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
          />
        </div>
        <SaveButton pending={update.isPending}>Save {tier.label}</SaveButton>
      </div>
      <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
    </form>
  )
}
