import { useState } from 'react'
import { useCompanySettings, useUpdateCompanySettings } from '@/hooks/useCompanySettings'
import type { CompanySettings } from '@/api/settings'
import { FormStatus, SettingsFormShell } from './formStatus'
import { NumberField, SaveButton } from './SlaForm'

/** Round a percent-input back to a 4-dp fraction (12 → 0.12), matching DECIMAL(6,4). */
function pctToFraction(pct: number): number {
  return Math.round((pct / 100) * 10_000) / 10_000
}

/**
 * Discrepancy threshold: shown as a percent, stored as a fraction on
 * company_settings.discrepancy_threshold_pct → PATCH /company.
 */
export function DiscrepancyThresholdForm() {
  const { data, isLoading, isError } = useCompanySettings()

  if (isLoading) {
    return (
      <SettingsFormShell slug="discrepancy-threshold" title="Discrepancy threshold">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError || !data) {
    return (
      <SettingsFormShell slug="discrepancy-threshold" title="Discrepancy threshold">
        <p role="alert" className="text-xs text-red-600">
          Could not load company settings.
        </p>
      </SettingsFormShell>
    )
  }
  return <Fields key={data.updated_at ?? 'disc'} settings={data} />
}

function Fields({ settings }: { settings: CompanySettings }) {
  const [pct, setPct] = useState(String(settings.discrepancy_threshold_pct * 100))
  const update = useUpdateCompanySettings()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next = pctToFraction(Number(pct))
    if (next === settings.discrepancy_threshold_pct) return
    update.mutate({ discrepancy_threshold_pct: next })
  }

  return (
    <SettingsFormShell
      slug="discrepancy-threshold"
      title="Discrepancy threshold"
      description="Percent gap between bid and opportunity quantity that flags a takeoff line."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <NumberField
          id="discrepancy-threshold"
          label="Discrepancy threshold (%)"
          value={pct}
          onChange={setPct}
          min={0}
          max={100}
          step={0.01}
        />
        <SaveButton pending={update.isPending} />
        <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
      </form>
    </SettingsFormShell>
  )
}
