import { TZDate } from '@date-fns/tz'

const HAS_TZ_DESIGNATOR = /([zZ])|([+-]\d{2}:?\d{2})$/

export function parseGraphDate(iso: string): Date {
  const normalized = HAS_TZ_DESIGNATOR.test(iso) ? iso : `${iso}Z`
  return new Date(normalized)
}

export function toUtcIso(wallClock: string, tz: string): string {
  // new Date(bareIso) parses as LOCAL time; split to numeric parts and
  // use TZDate's numeric constructor which treats them as wall-clock in `tz`.
  const [datePart, timePart] = wallClock.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute, second] = (timePart ?? '00:00:00').split(':').map(Number)
  const tzDate = new TZDate(year, month - 1, day, hour, minute, second ?? 0, tz)
  return new Date(tzDate).toISOString()
}
