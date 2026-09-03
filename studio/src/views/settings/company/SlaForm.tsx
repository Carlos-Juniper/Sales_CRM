import { useState } from 'react'
import { useCompanySettings, useUpdateCompanySettings } from '@/hooks/useCompanySettings'
import type { CompanySettings, CompanySettingsPatch } from '@/api/settings'
import { FormStatus, SettingsFormShell } from './formStatus'

/**
 * SLA config: return-window + at-risk threshold, both whole days → PATCH /company.
 * Only changed fields are sent (the backend audits one row per changed key).
 */
export function SlaForm() {
  const { data, isLoading, isError } = useCompanySettings()

  if (isLoading) {
    return (
      <SettingsFormShell slug="sla" title="SLA">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError || !data) {
    return (
      <SettingsFormShell slug="sla" title="SLA">
        <p role="alert" className="text-xs text-red-600">
          Could not load company settings.
        </p>
      </SettingsFormShell>
    )
  }
  // Remount the editable body once the server row lands so its local state
  // initializes from the loaded values without a set-state-in-effect.
  return <SlaFields key={data.updated_at ?? 'sla'} settings={data} />
}

function SlaFields({ settings }: { settings: CompanySettings }) {
  const [returnWindow, setReturnWindow] = useState(
    String(settings.sla_return_window_days),
  )
  const [atRisk, setAtRisk] = useState(String(settings.sla_at_risk_threshold_days))
  const update = useUpdateCompanySettings()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const patch: CompanySettingsPatch = {}
    const nextWindow = Number(returnWindow)
    const nextAtRisk = Number(atRisk)
    if (nextWindow !== settings.sla_return_window_days)
      patch.sla_return_window_days = nextWindow
    if (nextAtRisk !== settings.sla_at_risk_threshold_days)
      patch.sla_at_risk_threshold_days = nextAtRisk
    if (Object.keys(patch).length === 0) return
    update.mutate(patch)
  }

  return (
    <SettingsFormShell
      slug="sla"
      title="SLA"
      description="Return window and at-risk threshold, in whole days."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <NumberField
          id="sla-return-window"
          label="Return window (days)"
          value={returnWindow}
          onChange={setReturnWindow}
          min={0}
        />
        <NumberField
          id="sla-at-risk"
          label="At-risk threshold (days)"
          value={atRisk}
          onChange={setAtRisk}
          min={0}
        />
        <SaveButton pending={update.isPending} />
        <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
      </form>
    </SettingsFormShell>
  )
}

// ── Small shared controls (co-located; company forms only) ───────────────────

export function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-[var(--fg)] opacity-70 mb-1"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value)}
        className="w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
      />
    </div>
  )
}

export function SaveButton({
  pending,
  children = 'Save',
}: {
  pending: boolean
  children?: React.ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--sidebar-active-bg)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
    >
      {pending ? 'Saving…' : children}
    </button>
  )
}
