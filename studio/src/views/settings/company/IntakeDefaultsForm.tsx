import { useState } from 'react'
import { useCompanySettings, useUpdateCompanySettings } from '@/hooks/useCompanySettings'
import type { CompanySettings, CompanySettingsPatch } from '@/api/settings'
import { FormStatus, SettingsFormShell } from './formStatus'
import { NumberField, SaveButton } from './SlaForm'

const PRIORITIES = ['low', 'medium', 'high'] as const

function pctToFraction(pct: number): number {
  return Math.round((pct / 100) * 10_000) / 10_000
}

/** company_settings.default_notify_bm_rd_on_return stores 0/1 → coerce to bool. */
function toBool(v: boolean | number): boolean {
  return Boolean(v)
}

/**
 * Intake defaults: target margin + win probability (percents → fractions),
 * priority (label), and the notify-BM/RD-on-return flag → PATCH /company.
 */
export function IntakeDefaultsForm() {
  const { data, isLoading, isError } = useCompanySettings()

  if (isLoading) {
    return (
      <SettingsFormShell slug="intake-defaults" title="Intake defaults">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError || !data) {
    return (
      <SettingsFormShell slug="intake-defaults" title="Intake defaults">
        <p role="alert" className="text-xs text-red-600">
          Could not load company settings.
        </p>
      </SettingsFormShell>
    )
  }
  return <Fields key={data.updated_at ?? 'intake'} settings={data} />
}

function Fields({ settings }: { settings: CompanySettings }) {
  const [margin, setMargin] = useState(String(settings.default_target_margin * 100))
  const [winProb, setWinProb] = useState(
    String(settings.default_win_probability * 100),
  )
  const [priority, setPriority] = useState(settings.default_priority)
  const [notify, setNotify] = useState(
    toBool(settings.default_notify_bm_rd_on_return),
  )
  const update = useUpdateCompanySettings()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const patch: CompanySettingsPatch = {}
    const nextMargin = pctToFraction(Number(margin))
    const nextWin = pctToFraction(Number(winProb))
    if (nextMargin !== settings.default_target_margin)
      patch.default_target_margin = nextMargin
    if (nextWin !== settings.default_win_probability)
      patch.default_win_probability = nextWin
    if (priority !== settings.default_priority) patch.default_priority = priority
    if (notify !== toBool(settings.default_notify_bm_rd_on_return))
      patch.default_notify_bm_rd_on_return = notify
    if (Object.keys(patch).length === 0) return
    update.mutate(patch)
  }

  return (
    <SettingsFormShell
      slug="intake-defaults"
      title="Intake defaults"
      description="Seed values applied to a new estimate at intake."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <NumberField
          id="intake-target-margin"
          label="Target margin (%)"
          value={margin}
          onChange={setMargin}
          min={0}
          max={100}
          step={0.01}
        />
        <NumberField
          id="intake-win-probability"
          label="Win probability (%)"
          value={winProb}
          onChange={setWinProb}
          min={0}
          max={100}
          step={0.01}
        />
        <div>
          <label
            htmlFor="intake-priority"
            className="block text-xs font-medium text-[var(--fg)] opacity-70 mb-1"
          >
            Priority
          </label>
          <select
            id="intake-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="intake-notify-bm-rd"
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <label
            htmlFor="intake-notify-bm-rd"
            className="text-xs font-medium text-[var(--fg)] opacity-70"
          >
            Notify BM/RD on return
          </label>
        </div>
        <SaveButton pending={update.isPending} />
        <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
      </form>
    </SettingsFormShell>
  )
}
