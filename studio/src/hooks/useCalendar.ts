import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { graphApi } from '@/api/graph'
import { ApiError } from '@/api/client'
import { useUIStore } from '@/store/uiStore'
import type { CalendarEventCreatePayload, ScheduleMeetingPayload } from '@/types'

export const CALENDAR_KEY = 'calendar'

export function useCalendarEvents(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: [CALENDAR_KEY, start, end],
    queryFn: () => graphApi.listEvents(start, end),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function useCreateCalendarEvent() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (payload: CalendarEventCreatePayload) => graphApi.createEvent(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CALENDAR_KEY] })
      toast('Meeting created', { variant: 'success' })
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError && err.status === 400
        ? 'Connect your Microsoft account to create meetings'
        : 'Could not create meeting'
      toast(msg, { variant: 'error' })
    },
  })
}

export function useScheduleMeeting(leadId: string) {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (payload: ScheduleMeetingPayload) => graphApi.scheduleMeeting(leadId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CALENDAR_KEY] })
      qc.invalidateQueries({ queryKey: ['activity', leadId] })
      toast('Meeting scheduled', { variant: 'success' })
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError && err.status === 400
        ? 'Connect your Microsoft account to schedule meetings'
        : 'Could not schedule meeting'
      toast(msg, { variant: 'error' })
    },
  })
}
