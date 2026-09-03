import { useState } from 'react'
import { useMarginBands, useUpdateMarginBand } from '@/hooks/useCompanySettings'
import type { MarginBandRow } from '@/types/estimating'
import type { MarginBandPatch as MarginBandPatchBody } from '@/api/settings'
import { FormStatus, SettingsFormShell } from './formStatus'
import { NumberField, SaveButton } from './SlaForm'

function pctToFraction(pct: number): number {
  return Math.round((pct / 100) * 10_000) / 10_000
}

/**
 * Margin bands: good/ok thresholds (fractions, shown as percents) → PATCH
 * /company/margin-bands/{id}. Company-scoped per §2.4 — a BM must not edit
 * these. The UI edits the canonical row named 'default'.
 */
export function MarginBandsForm() {
  const { data, isLoading, isError } = useMarginBands()

  if (isLoading) {
    return (
      <SettingsFormShell slug="margin-bands" title="Margin bands">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  const band = data?.find((b) => b.name === 'default') ?? data?.[0]
  if (isError || !band) {
    return (
      <SettingsFormShell slug="margin-bands" title="Margin bands">
        <p role="alert" className="text-xs text-red-600">
          Could not load margin bands.
        </p>
      </SettingsFormShell>
    )
  }
  return <Fields key={band.id} band={band} />
}

function Fields({ band }: { band: MarginBandRow }) {
  const [good, setGood] = useState(String(band.goodMin * 100))
  const [ok, setOk] = useState(String(band.okMin * 100))
  const update = useUpdateMarginBand()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const patch: MarginBandPatchBody = {}
    const nextGood = pctToFraction(Number(good))
    const nextOk = pctToFraction(Number(ok))
    if (nextGood !== band.goodMin) patch.good_min = nextGood
    if (nextOk !== band.okMin) patch.ok_min = nextOk
    if (Object.keys(patch).length === 0) return
    update.mutate({ bandId: band.id, body: patch })
  }

  return (
    <SettingsFormShell
      slug="margin-bands"
      title="Margin bands"
      description="Good/OK margin thresholds. A margin below OK is flagged low."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <NumberField
          id="margin-good-min"
          label="Good margin floor (%)"
          value={good}
          onChange={setGood}
          min={0}
          max={100}
          step={0.01}
        />
        <NumberField
          id="margin-ok-min"
          label="OK margin floor (%)"
          value={ok}
          onChange={setOk}
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
