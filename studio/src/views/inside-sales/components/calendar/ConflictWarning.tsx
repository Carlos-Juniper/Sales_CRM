import { AlertTriangle } from 'lucide-react'
import { parseGraphDate } from '@/lib/graphDates'
import type { CalendarEvent } from '@/types'

export interface ConflictWarningProps {
  conflicts: CalendarEvent[]
}

function formatRange(event: CalendarEvent): string {
  const start = parseGraphDate(event.start.dateTime)
  const end = parseGraphDate(event.end.dateTime)
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${fmt(start)}–${fmt(end)}`
}

export function ConflictWarning({ conflicts }: ConflictWarningProps) {
  if (conflicts.length === 0) return null

  return (
    <div
      role="alert"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 space-y-1"
    >
      <div className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Scheduling conflict
      </div>
      <ul className="space-y-0.5 pl-5 list-disc">
        {conflicts.map((event) => (
          <li key={event.id}>
            <span className="font-medium">{event.subject}</span>{' '}
            <span className="text-amber-700">({formatRange(event)})</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
