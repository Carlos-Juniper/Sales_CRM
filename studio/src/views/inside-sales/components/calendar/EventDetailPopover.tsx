import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Pencil, Trash2, Video, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseGraphDate } from '@/lib/graphDates'
import { useDeleteCalendarEvent } from '@/hooks/useCalendar'
import type { CalendarEvent } from '@/types'

export interface EventDetailPopoverProps {
  event: CalendarEvent | null
  anchorEl: HTMLElement | null
  onClose: () => void
  onEdit: (event: CalendarEvent) => void
}

function formatTimeRange(event: CalendarEvent): string {
  const start = parseGraphDate(event.start.dateTime)
  const end = parseGraphDate(event.end.dateTime)
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const dateStr = start.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return `${dateStr}, ${fmt(start)} – ${fmt(end)}`
}

interface EventDetailContentProps {
  event: CalendarEvent
  anchorEl: HTMLElement | null
  onClose: () => void
  onEdit: (event: CalendarEvent) => void
}

function EventDetailContent({ event, anchorEl, onClose, onEdit }: EventDetailContentProps) {
  const deleteMutation = useDeleteCalendarEvent()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const pos = useMemo(() => {
    if (!anchorEl) return { top: 0, left: 0 }
    const rect = anchorEl.getBoundingClientRect()
    return {
      top: rect.bottom + window.scrollY + 8,
      left: rect.left + window.scrollX,
    }
  }, [anchorEl])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorEl !== e.target &&
        !anchorEl?.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [anchorEl, onClose])

  async function handleConfirmDelete() {
    try {
      await deleteMutation.mutateAsync(event.id)
      onClose()
    } catch {
      // toast shown by mutation onError
    }
  }

  return (
    <div
      ref={popoverRef}
      style={{ position: 'absolute', top: pos.top, left: pos.left, zIndex: 1400 }}
      className="w-80 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl p-4 space-y-3"
      role="dialog"
      aria-label={event.subject}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5 flex-1 min-w-0">
          <p className="font-semibold text-sm text-[hsl(var(--fg))] truncate">{event.subject}</p>
          <p className="text-xs text-[hsl(var(--muted-fg))]">{formatTimeRange(event)}</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] rounded p-0.5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {event.attendees.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-[hsl(var(--muted-fg))]">Attendees</p>
          <ul className="space-y-0.5">
            {event.attendees.map((a) => (
              <li key={a.emailAddress.address} className="text-xs text-[hsl(var(--fg))]">
                {a.emailAddress.name
                  ? `${a.emailAddress.name} (${a.emailAddress.address})`
                  : a.emailAddress.address}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {event.onlineMeeting?.joinUrl && (
          <a
            href={event.onlineMeeting.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join Teams"
            className="inline-flex items-center gap-1.5 text-xs text-[#2E7D52] hover:underline font-medium"
          >
            <Video className="h-3.5 w-3.5" />
            Join Teams
          </a>
        )}
        {event.webLink && (
          <a
            href={event.webLink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in Outlook"
            className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Outlook
          </a>
        )}
      </div>

      {event.isOrganizer && (
        <>
          {confirmDelete ? (
            <div className="space-y-2 border-t border-[hsl(var(--border))] pt-3">
              <p className="text-xs text-[hsl(var(--fg))]">Delete this event?</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleteMutation.isPending}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirmDelete}
                  disabled={deleteMutation.isPending}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  aria-label="Confirm delete"
                >
                  {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 border-t border-[hsl(var(--border))] pt-3">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={() => onEdit(event)}
                aria-label="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 gap-1.5 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function EventDetailPopover({
  event,
  anchorEl,
  onClose,
  onEdit,
}: EventDetailPopoverProps) {
  if (!event) return null

  return createPortal(
    <EventDetailContent
      key={event.id}
      event={event}
      anchorEl={anchorEl}
      onClose={onClose}
      onEdit={onEdit}
    />,
    document.body,
  )
}
