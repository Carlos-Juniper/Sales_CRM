import { useMemo, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AttendeeChipInput } from './AttendeeChipInput'
import { ConflictWarning } from './ConflictWarning'
import { findConflicts } from '@/lib/calendarConflicts'
import { toUtcIso, parseGraphDate } from '@/lib/graphDates'
import {
  TIMEZONE_OPTIONS,
  getBrowserTimezone,
  resolveToSupportedTimezone,
} from '@/lib/timezones'
import {
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useScheduleMeeting,
} from '@/hooks/useCalendar'
import type { CalendarEvent } from '@/types'

export interface EventFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: CalendarEvent[]
  event?: CalendarEvent | null
  initialSlot?: { start: Date; end: Date } | null
  leadMode?: { leadId: string; contactEmail: string | null } | null
  defaultSubject?: string
}

function toLocalDate(dateTime: string): string {
  const d = parseGraphDate(dateTime)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toLocalTime(dateTime: string): string {
  const d = parseGraphDate(dateTime)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toDateInputValue(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function buildInitialAttendees(
  event: CalendarEvent | null | undefined,
  leadMode: EventFormDialogProps['leadMode'],
): string[] {
  if (event) {
    return event.attendees.map((a) => a.emailAddress.address)
  }
  if (leadMode?.contactEmail) {
    return [leadMode.contactEmail]
  }
  return []
}

interface EventFormBodyProps {
  events: CalendarEvent[]
  event?: CalendarEvent | null
  leadMode?: { leadId: string; contactEmail: string | null } | null
  defaultSubject?: string
  initialSlot?: { start: Date; end: Date } | null
  onOpenChange: (open: boolean) => void
}

function EventFormBody({
  events,
  event,
  leadMode,
  defaultSubject,
  initialSlot,
  onOpenChange,
}: EventFormBodyProps) {
  const isEdit = Boolean(event)

  const [subject, setSubject] = useState(
    event?.subject ?? defaultSubject ?? '',
  )
  const [date, setDate] = useState(
    initialSlot
      ? toDateInputValue(initialSlot.start)
      : event
        ? toLocalDate(event.start.dateTime)
        : '',
  )
  const [startTime, setStartTime] = useState(
    initialSlot
      ? toTimeInputValue(initialSlot.start)
      : event
        ? toLocalTime(event.start.dateTime)
        : '10:00',
  )
  const [endTime, setEndTime] = useState(
    initialSlot
      ? toTimeInputValue(initialSlot.end)
      : event
        ? toLocalTime(event.end.dateTime)
        : '11:00',
  )
  const [timezone, setTimezone] = useState(
    resolveToSupportedTimezone(getBrowserTimezone()),
  )
  const [attendees, setAttendees] = useState<string[]>(
    () => buildInitialAttendees(event, leadMode),
  )
  const [body, setBody] = useState(event?.bodyPreview ?? '')
  const [teamsEnabled, setTeamsEnabled] = useState(true)
  const [timeError, setTimeError] = useState<string | null>(null)

  const conflicts = useMemo(() => {
    if (!date || !startTime || !endTime) return []
    // Use parseGraphDate (appends Z for bare ISO) so proposed wall-clock times
    // are compared in the same UTC reference frame as the stored Graph events.
    const proposedStart = parseGraphDate(`${date}T${startTime}:00`)
    const proposedEnd = parseGraphDate(`${date}T${endTime}:00`)
    if (proposedEnd <= proposedStart) return []
    return findConflicts({ start: proposedStart, end: proposedEnd }, events, event?.id)
  }, [date, startTime, endTime, events, event?.id])

  const createMutation = useCreateCalendarEvent()
  const updateMutation = useUpdateCalendarEvent()
  const scheduleMutation = useScheduleMeeting(leadMode?.leadId ?? '')

  const isPending =
    createMutation.isPending || updateMutation.isPending || scheduleMutation.isPending

  const isSubmitDisabled =
    !subject.trim() || !date || !startTime || !endTime || isPending

  const isOccurrence = event?.type === 'occurrence' || event?.type === 'exception'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTimeError(null)

    const wallStart = `${date}T${startTime}:00`
    const wallEnd = `${date}T${endTime}:00`
    const startIso = toUtcIso(wallStart, timezone)
    const endIso = toUtcIso(wallEnd, timezone)

    if (new Date(endIso) <= new Date(startIso)) {
      setTimeError('End time must be after start time')
      return
    }

    try {
      if (leadMode) {
        await scheduleMutation.mutateAsync({
          subject: subject.trim(),
          start_iso: startIso,
          end_iso: endIso,
          attendees,
          body: body || undefined,
          online_meeting: teamsEnabled,
        })
      } else if (isEdit && event) {
        const payload: Record<string, unknown> = {}
        if (subject.trim() !== event.subject) payload.subject = subject.trim()
        payload.start_iso = startIso
        payload.end_iso = endIso
        const originalAttendees = event.attendees.map((a) => a.emailAddress.address)
        if (JSON.stringify(attendees) !== JSON.stringify(originalAttendees)) {
          payload.attendees = attendees
        }
        if (body !== (event.bodyPreview ?? '')) payload.body = body

        await updateMutation.mutateAsync({ id: event.id, payload })
      } else {
        await createMutation.mutateAsync({
          subject: subject.trim(),
          start_iso: startIso,
          end_iso: endIso,
          attendees,
          body: body || undefined,
          online_meeting: teamsEnabled,
        })
      }
      onOpenChange(false)
    } catch {
      // toast shown by mutation onError
    }
  }

  const submitLabel = isPending
    ? 'Saving…'
    : isEdit
      ? 'Save changes'
      : leadMode
        ? 'Schedule'
        : 'Create event'

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-1">
      {isOccurrence && (
        <p className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
          This event repeats — changes apply to this occurrence only.
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="event-subject" className="text-sm font-medium text-gray-700">
          Subject
        </label>
        <Input
          id="event-subject"
          aria-label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Meeting subject"
          required
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="event-date" className="text-sm font-medium text-gray-700">
          Date
        </label>
        <Input
          id="event-date"
          aria-label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="event-start-time" className="text-sm font-medium text-gray-700">
            Start
          </label>
          <Input
            id="event-start-time"
            data-testid="start-time"
            role="spinbutton"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="event-end-time" className="text-sm font-medium text-gray-700">
            End
          </label>
          <Input
            id="event-end-time"
            data-testid="end-time"
            role="spinbutton"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </div>
      </div>

      {timeError && (
        <p className="text-xs text-red-500">{timeError}</p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="event-timezone" className="text-sm font-medium text-gray-700">
          Timezone
        </label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id="event-timezone" aria-label="Timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Attendees</label>
        <AttendeeChipInput value={attendees} onChange={setAttendees} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="event-body" className="text-sm font-medium text-gray-700">
          Notes (optional)
        </label>
        <Textarea
          id="event-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add notes or agenda…"
          rows={3}
        />
      </div>

      <div className="flex items-center justify-between">
        <label htmlFor="event-teams" className="text-sm font-medium text-gray-700">
          Teams meeting
        </label>
        <Switch
          id="event-teams"
          checked={teamsEnabled}
          onCheckedChange={setTeamsEnabled}
        />
      </div>

      {conflicts.length > 0 && <ConflictWarning conflicts={conflicts} />}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="bg-[#2E7D52] hover:bg-[#256644] text-white"
          disabled={isSubmitDisabled}
        >
          <CalendarPlus className="h-4 w-4" />
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function EventFormDialog({
  open,
  onOpenChange,
  events,
  event,
  initialSlot,
  leadMode,
  defaultSubject,
}: EventFormDialogProps) {
  const isEdit = Boolean(event)
  const formKey = open ? (event?.id ?? 'create') : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit event' : leadMode ? 'Schedule a meeting' : 'New event'}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update event details.' : 'Fill in the event details below.'}
          </DialogDescription>
        </DialogHeader>

        <EventFormBody
          key={String(formKey)}
          events={events}
          event={event}
          leadMode={leadMode}
          defaultSubject={defaultSubject}
          initialSlot={initialSlot}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}
