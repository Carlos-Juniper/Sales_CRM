import { apiClient } from './client'
import type { CalendarEvent, CalendarEventCreatePayload, CalendarEventUpdatePayload, ScheduleMeetingPayload } from '@/types'

export const graphApi = {
  listEvents(start: string, end: string) {
    const params = new URLSearchParams({ start, end })
    return apiClient.get<CalendarEvent[]>(`/calendar/events?${params}`)
  },

  createEvent(payload: CalendarEventCreatePayload) {
    return apiClient.post<CalendarEvent>('/calendar/events', payload)
  },

  updateEvent(eventId: string, payload: CalendarEventUpdatePayload) {
    return apiClient.patch<CalendarEvent>(`/calendar/events/${eventId}`, payload)
  },

  deleteEvent(eventId: string) {
    return apiClient.delete(`/calendar/events/${eventId}`)
  },

  scheduleMeeting(leadId: string, payload: ScheduleMeetingPayload) {
    return apiClient.post<{ event: CalendarEvent; lead_id: string }>(
      `/leads/${leadId}/schedule-meeting`,
      payload,
    )
  },
}
