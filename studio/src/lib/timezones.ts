export interface TimezoneOption {
  label: string
  value: string
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { label: 'ET', value: 'America/New_York' },
  { label: 'CT', value: 'America/Chicago' },
  { label: 'MT', value: 'America/Denver' },
  { label: 'PT', value: 'America/Los_Angeles' },
]

export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function resolveToSupportedTimezone(tz: string): string {
  const match = TIMEZONE_OPTIONS.find((opt) => opt.value === tz)
  if (match) return match.value
  return TIMEZONE_OPTIONS[0].value
}
