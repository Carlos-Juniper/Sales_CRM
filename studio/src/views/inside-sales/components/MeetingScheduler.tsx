import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EventFormDialog } from './calendar/EventFormDialog'
import type { Lead } from '@/types'

interface MeetingSchedulerProps {
  lead: Lead
}

export function MeetingScheduler({ lead }: MeetingSchedulerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        Schedule meeting
      </Button>

      <EventFormDialog
        open={open}
        onOpenChange={setOpen}
        events={[]}
        defaultSubject={`Site visit — ${lead.property_name}`}
        leadMode={{
          leadId: lead.id,
          contactEmail: lead.contact_email,
        }}
        initialSlot={null}
      />
    </>
  )
}
