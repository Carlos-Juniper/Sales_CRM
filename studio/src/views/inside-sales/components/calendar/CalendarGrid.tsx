import { useRef, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput, EventDropArg, EventClickArg, DatesSetArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import { parseGraphDate } from '@/lib/graphDates'
import { useUpdateCalendarEvent } from '@/hooks/useCalendar'
import type { CalendarEvent } from '@/types'
import './calendar.css'

export type CalendarView = 'timeGridWeek' | 'threeDay' | 'timeGridDay'

// eslint-disable-next-line react-refresh/only-export-components
export function calendarEventToInput(event: CalendarEvent): EventInput {
  return {
    id: event.id,
    title: event.subject,
    start: parseGraphDate(event.start.dateTime),
    end: parseGraphDate(event.end.dateTime),
    classNames: ['fc-event-organizer'],
    extendedProps: {
      raw: event,
      isOrganizer: event.isOrganizer ?? false,
    },
  }
}

interface CalendarGridProps {
  events: CalendarEvent[]
  view: CalendarView
  onDatesSet: (start: string, end: string) => void
  onSlotSelect: (slot: { start: Date; end: Date }) => void
  onEventClick: (event: CalendarEvent, element: HTMLElement) => void
}

export function CalendarGrid({ events, view, onDatesSet, onSlotSelect, onEventClick }: CalendarGridProps) {
  const calRef = useRef<FullCalendar>(null)
  const updateEvent = useUpdateCalendarEvent()

  // Sync the FullCalendar view whenever the view prop changes
  useEffect(() => {
    const api = calRef.current?.getApi()
    if (api && api.view.type !== view) {
      api.changeView(view)
    }
  }, [view])

  const eventInputs: EventInput[] = events.map(calendarEventToInput)

  const isMobile = window.matchMedia('(max-width: 767px)').matches

  function handleEventDrop(arg: EventDropArg) {
    const raw: CalendarEvent = arg.event.extendedProps.raw
    if (!raw) return
    updateEvent.mutate({
      id: raw.id,
      payload: {
        start_iso: arg.event.start?.toISOString(),
        end_iso: arg.event.end?.toISOString(),
      },
    })
  }

  function handleEventResize(arg: EventResizeDoneArg) {
    const raw: CalendarEvent = arg.event.extendedProps.raw
    if (!raw) return
    updateEvent.mutate({
      id: raw.id,
      payload: {
        start_iso: arg.event.start?.toISOString(),
        end_iso: arg.event.end?.toISOString(),
      },
    })
  }

  function handleEventClick(arg: EventClickArg) {
    const raw: CalendarEvent = arg.event.extendedProps.raw
    if (raw) {
      onEventClick(raw, arg.el)
    }
  }

  function handleDatesSet(arg: DatesSetArg) {
    onDatesSet(arg.startStr, arg.endStr)
  }

  return (
    <FullCalendar
      ref={calRef}
      plugins={[timeGridPlugin, interactionPlugin]}
      initialView={isMobile ? 'timeGridDay' : 'timeGridWeek'}
      views={{
        threeDay: { type: 'timeGrid', duration: { days: 3 } },
      }}
      headerToolbar={false}
      selectable
      editable
      eventAllow={(_, event) => event?.extendedProps.isOrganizer === true}
      events={eventInputs}
      eventDrop={handleEventDrop}
      eventResize={handleEventResize}
      eventClick={handleEventClick}
      select={(selectionInfo) => onSlotSelect({ start: selectionInfo.start, end: selectionInfo.end })}
      datesSet={handleDatesSet}
      nowIndicator
      slotMinTime="06:00"
      slotMaxTime="20:00"
      height="100%"
    />
  )
}
