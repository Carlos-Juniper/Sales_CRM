import { UpcomingMeetings } from './UpcomingMeetings'
import { MeetingScheduler } from './MeetingScheduler'
import type { Lead } from '@/types'

interface CalendarTabProps {
  lead: Lead
}

export function CalendarTab({ lead }: CalendarTabProps) {
  return (
    <div className="px-6 py-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Upcoming meetings</h3>
        <MeetingScheduler lead={lead} />
      </div>

      <UpcomingMeetings />
    </div>
  )
}
