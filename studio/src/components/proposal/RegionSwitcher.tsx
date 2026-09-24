import { ALL_REGIONS_LABEL, REGION_ALL, REGION_MINE, type RegionFilterChoice, type RegionOption } from '@/lib/proposal/regionFilter'

/**
 * "My region" omits `region_id`. Each named region sends that id.
 * "All regions" sends `region_id=all`.
 *
 * Colors come from the theme tokens so the control tracks light and dark mode.
 */
export function RegionSwitcher({
  id,
  label = 'Region',
  regions,
  value,
  onChange,
  testId,
}: {
  id: string
  label?: string
  regions: RegionOption[]
  value: RegionFilterChoice
  onChange: (next: RegionFilterChoice) => void
  testId: string
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-[11px] text-[hsl(var(--muted-fg))]">
      {label}
      <select
        id={id}
        aria-label={label}
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 cursor-pointer rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]"
      >
        <option value={REGION_MINE}>My region</option>
        {regions.map((region) => (
          <option key={region.regionId} value={region.regionId}>
            {region.regionName}
          </option>
        ))}
        <option value={REGION_ALL}>{ALL_REGIONS_LABEL}</option>
      </select>
    </label>
  )
}

/** Badge for a roster row whose `regionId` is null (shown in every region filter). */
export function AllRegionsBadge({
  regionId,
  testId,
}: {
  regionId: string | null | undefined
  testId?: string
}) {
  if (regionId !== null) return null
  return (
    <span
      data-testid={testId}
      className="ml-2 inline-flex items-center whitespace-nowrap rounded bg-[hsl(var(--muted))] px-1 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-fg))]"
    >
      {ALL_REGIONS_LABEL}
    </span>
  )
}
