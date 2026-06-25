import { Calendar, ExternalLink, Video } from 'lucide-react'
import { useCalendarEvents } from '@/hooks/useCalendar'
import type { CalendarEvent } from '@/types'

function formatEventTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

interface UpcomingMeetingsProps {
  /** ISO datetime for window start (defaults to now) */
  start?: string
  /** ISO datetime for window end (defaults to +7 days) */
  end?: string
}

export function UpcomingMeetings({ start, end }: UpcomingMeetingsProps) {
  const now = new Date()
  const windowStart = start ?? now.toISOString()
  const windowEnd = end ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: events, isLoading, isError } = useCalendarEvents(windowStart, windowEnd)

  if (isError) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center">
        <Calendar className="h-6 w-6 text-gray-300 mx-auto mb-2" />
        <p className="text-xs text-gray-400">
          Connect your Microsoft account to see upcoming meetings.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-gray-100 animate-pulse" />
        ))}
      </div>
    )
  }

  if (!events || events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center">
        <Calendar className="h-6 w-6 text-gray-300 mx-auto mb-2" />
        <p className="text-xs text-gray-400">No meetings in the next 7 days.</p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {events.map((event: CalendarEvent) => (
        <li
          key={event.id}
          className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5"
        >
          <div className="flex-shrink-0 mt-0.5">
            {event.onlineMeeting ? (
              <Video className="h-4 w-4 text-[#2E7D52]" />
            ) : (
              <Calendar className="h-4 w-4 text-gray-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{event.subject}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatEventTime(event.start.dateTime)}
            </p>
            {event.attendees.length > 0 && (
              <p className="text-xs text-gray-400 truncate">
                {event.attendees.map((a) => a.emailAddress.address).join(', ')}
              </p>
            )}
          </div>
          {event.onlineMeeting?.joinUrl && (
            <a
              href={event.onlineMeeting.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-[#2E7D52] hover:text-[#256644]"
              aria-label="Join Teams meeting"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}
