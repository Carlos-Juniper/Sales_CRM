import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { useCalendarEvents } from '@/hooks/useCalendar'
import { ApiError } from '@/api/client'
import { getBrowserTimezone, TIMEZONE_OPTIONS } from '@/lib/timezones'
import { CalendarGrid } from './components/calendar/CalendarGrid'
import { EventFormDialog } from './components/calendar/EventFormDialog'
import { EventDetailPopover } from './components/calendar/EventDetailPopover'
import type { CalendarEvent } from '@/types'
import type { CalendarView } from './components/calendar/CalendarGrid'

// Module-level: view selection survives navigation (remounts) within the session
let persistedView: CalendarView = window.matchMedia('(max-width: 767px)').matches
  ? 'timeGridDay'
  : 'timeGridWeek'

function getBrowserTimezoneLabel(): string {
  const tz = getBrowserTimezone()
  // Try to match Intl short abbreviation first (e.g. "EDT", "CDT")
  const shortLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short',
  })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value

  if (shortLabel) return shortLabel

  // Fall back to the matched supported-zone label
  const match = TIMEZONE_OPTIONS.find((opt) => opt.value === tz)
  return match?.label ?? tz
}

const VIEW_LABELS: Record<CalendarView, string> = {
  timeGridWeek: 'Week',
  threeDay: '3-day',
  timeGridDay: 'Day',
}

export default function CalendarPage() {
  const [view, setView] = useState<CalendarView>(persistedView)
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogEvent, setDialogEvent] = useState<CalendarEvent | null>(null)
  const [dialogSlot, setDialogSlot] = useState<{ start: Date; end: Date } | null>(null)

  const [popoverEvent, setPopoverEvent] = useState<CalendarEvent | null>(null)
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)

  const { data: events, isLoading, isError, error, refetch } = useCalendarEvents(
    rangeStart,
    rangeEnd,
    rangeStart !== '' && rangeEnd !== '',
  )

  const tzLabel = getBrowserTimezoneLabel()

  const handleDatesSet = useCallback((start: string, end: string) => {
    setRangeStart(start)
    setRangeEnd(end)
  }, [])

  const handleSlotSelect = useCallback((slot: { start: Date; end: Date }) => {
    setDialogEvent(null)
    setDialogSlot(slot)
    setDialogOpen(true)
  }, [])

  const handleEventClick = useCallback((event: CalendarEvent, element: HTMLElement) => {
    setPopoverEvent(event)
    setPopoverAnchor(element)
  }, [])

  const handlePopoverEdit = useCallback((event: CalendarEvent) => {
    setPopoverEvent(null)
    setPopoverAnchor(null)
    setDialogEvent(event)
    setDialogSlot(null)
    setDialogOpen(true)
  }, [])

  const handlePopoverClose = useCallback(() => {
    setPopoverEvent(null)
    setPopoverAnchor(null)
  }, [])

  const handleViewChange = useCallback((v: string) => {
    const next = v as CalendarView
    persistedView = next
    setView(next)
  }, [])

  const is400 = isError && error instanceof ApiError && (error as ApiError).status === 400
  const is5xx = isError && !(is400)

  const activeEvents = events ?? []

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav
        title="Calendar"
        subtitle={`Times shown in ${tzLabel}`}
        actions={
          <Tabs value={view} onValueChange={handleViewChange}>
            <TabsList>
              {(Object.entries(VIEW_LABELS) as [CalendarView, string][]).map(([v, label]) => (
                <TabsTrigger key={v} value={v}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="flex-1 overflow-hidden relative">
        {isLoading && (
          <CalendarLoadingSkeleton />
        )}

        {is400 && (
          <CalendarNotConnectedState />
        )}

        {is5xx && (
          <CalendarErrorState onRetry={() => refetch()} />
        )}

        {!isLoading && !is400 && (
          <div className="h-full p-4">
            <CalendarGrid
              events={activeEvents}
              view={view}
              onDatesSet={handleDatesSet}
              onSlotSelect={handleSlotSelect}
              onEventClick={handleEventClick}
            />
          </div>
        )}
      </div>

      <EventFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        events={activeEvents}
        event={dialogEvent}
        initialSlot={dialogSlot}
        leadMode={null}
      />

      <EventDetailPopover
        event={popoverEvent}
        anchorEl={popoverAnchor}
        onClose={handlePopoverClose}
        onEdit={handlePopoverEdit}
      />
    </div>
  )
}

function CalendarLoadingSkeleton() {
  return (
    <div className="absolute inset-0 p-4 space-y-2" aria-label="Loading calendar">
      <div className="flex gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="flex-1 h-8 rounded" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex gap-2">
          <Skeleton className="w-12 h-14 rounded" />
          {Array.from({ length: 7 }).map((_, j) => (
            <Skeleton key={j} className="flex-1 h-14 rounded" />
          ))}
        </div>
      ))}
    </div>
  )
}

function CalendarNotConnectedState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="rounded-lg border-2 border-dashed border-[hsl(var(--border))] px-10 py-12 text-center max-w-sm">
        <Calendar className="h-10 w-10 text-[hsl(var(--muted-fg))] mx-auto mb-4" />
        <h3 className="text-sm font-semibold text-[hsl(var(--fg))] mb-2">
          Connect your Microsoft account
        </h3>
        <p className="text-xs text-[hsl(var(--muted-fg))] mb-4">
          Link your Microsoft 365 account to see your calendar and schedule meetings.
        </p>
        <Link
          to="/inside-sales/settings/connections"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2E7D52] hover:text-[#256644] underline underline-offset-2"
        >
          Connect account
        </Link>
      </div>
    </div>
  )
}

function CalendarErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="text-center">
        <p className="text-sm text-[hsl(var(--muted-fg))] mb-3">Could not load calendar</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  )
}
