import { useState } from 'react'
import {
  useBranchSettings,
  useUpdateBranchSettings,
} from '@/hooks/useBranchSettings'
import type { BranchSettings } from '@/api/settings'
import { FormStatus, SettingsFormShell } from '../company/formStatus'
import { NumberField, SaveButton } from '../company/SlaForm'

/**
 * Branch crew rate: a single dollars-per-hour input mapping to
 * `crewRateCentsPerHour` (dollars↔cents) → PATCH /branch/{id}.
 *
 * §2.3 no-fallback (write side): when the branch has NO configured rate the GET
 * returns `crewRateCentsPerHour: null`. Rather than showing $0.00 (an invented
 * number), the form renders an explicit "not configured" prompt so the admin/BM
 * knows they are SETTING the rate for the first time, not editing an existing one.
 */
export function CrewRateForm({ aspireBranchId }: { aspireBranchId: number }) {
  const { data, isLoading, isError } = useBranchSettings(aspireBranchId)

  if (isLoading) {
    return (
      <SettingsFormShell slug="crew-rate" title="Crew rate">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError || !data) {
    return (
      <SettingsFormShell slug="crew-rate" title="Crew rate">
        <p role="alert" className="text-xs text-red-600">
          Could not load branch settings.
        </p>
      </SettingsFormShell>
    )
  }
  // Remount when the branch or its rate changes so the local input re-initializes
  // from the loaded value without a set-state-in-effect.
  return (
    <CrewRateFields
      key={`${aspireBranchId}:${data.crewRateCentsPerHour ?? 'none'}`}
      aspireBranchId={aspireBranchId}
      settings={data}
    />
  )
}

/** Cents → whole/decimal dollars for display (7000 → "70", 6550 → "65.5"). */
function centsToDollars(cents: number): string {
  return String(cents / 100)
}
/** Dollars → integer cents (70 → 7000), rounded to avoid float drift. */
function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

function CrewRateFields({
  aspireBranchId,
  settings,
}: {
  aspireBranchId: number
  settings: BranchSettings
}) {
  const configured = settings.crewRateCentsPerHour !== null
  const [dollars, setDollars] = useState(
    configured ? centsToDollars(settings.crewRateCentsPerHour as number) : '',
  )
  const update = useUpdateBranchSettings(aspireBranchId)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (dollars.trim() === '') return
    const cents = dollarsToCents(Number(dollars))
    if (cents === settings.crewRateCentsPerHour) return
    update.mutate({ crewRateCentsPerHour: cents })
  }

  return (
    <SettingsFormShell
      slug="crew-rate"
      title="Crew rate"
      description="Blended crew cost in dollars per hour for this branch."
    >
      {!configured && (
        <p
          data-testid="crew-rate-unconfigured"
          className="mb-3 rounded-md border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          Crew rate is not configured for this branch yet. Estimates for this
          branch cannot compute labor cost until you set one.
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <NumberField
          id="crew-rate"
          label="Crew rate ($/hr)"
          value={dollars}
          onChange={setDollars}
          min={0}
          step={0.01}
        />
        <SaveButton pending={update.isPending}>
          {configured ? 'Save' : 'Set crew rate'}
        </SaveButton>
        <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
      </form>
    </SettingsFormShell>
  )
}
