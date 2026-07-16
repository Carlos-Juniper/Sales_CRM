import type { CalendarEvent } from '@/types'

export function findConflicts(
  proposed: { start: Date; end: Date },
  events: CalendarEvent[],
  excludeEventId?: string,
): CalendarEvent[] {
  return events.filter((event) => {
    if (event.showAs === 'free') return false
    if (event.isCancelled) return false
    if (excludeEventId !== undefined && event.id === excludeEventId) return false

    const eventStart = new Date(event.start.dateTime)
    const eventEnd = new Date(event.end.dateTime)

    return proposed.start < eventEnd && eventStart < proposed.end
  })
}
