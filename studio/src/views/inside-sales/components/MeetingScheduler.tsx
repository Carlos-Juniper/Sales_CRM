import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useScheduleMeeting } from '@/hooks/useCalendar'
import type { Lead } from '@/types'

interface MeetingSchedulerProps {
  lead: Lead
}

export function MeetingScheduler({ lead }: MeetingSchedulerProps) {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState(`Site visit — ${lead.property_name}`)
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('11:00')

  const schedule = useScheduleMeeting(lead.id)

  const contactEmail = lead.contact_email ?? ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || !startTime || !endTime) return

    // The date/time inputs are the user's LOCAL wall-clock time. Parse them as
    // local (no trailing 'Z') and convert to UTC ISO so the event lands at the
    // intended time regardless of the user's timezone (backend stores UTC).
    const startIso = new Date(`${date}T${startTime}:00`).toISOString()
    const endIso = new Date(`${date}T${endTime}:00`).toISOString()

    try {
      await schedule.mutateAsync({
        subject,
        start_iso: startIso,
        end_iso: endIso,
        attendees: contactEmail ? [contactEmail] : [],
        online_meeting: true,
      })
      setOpen(false)
    } catch {
      // toast shown by useScheduleMeeting onError
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <CalendarPlus className="h-3.5 w-3.5" />
          Schedule meeting
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule a meeting</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Subject</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Meeting subject"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Date</label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Start</label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">End</label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {contactEmail && (
            <p className="text-xs text-gray-500">
              Invite will be sent to <span className="font-medium">{contactEmail}</span>
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={schedule.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-[#2E7D52] hover:bg-[#256644] text-white"
              disabled={schedule.isPending || !date}
            >
              <CalendarPlus className="h-4 w-4" />
              {schedule.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
