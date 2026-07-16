import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { graphApi } from '@/api/graph'
import { ApiError } from '@/api/client'
import { useUIStore } from '@/store/uiStore'
import type { CalendarEvent, CalendarEventCreatePayload, CalendarEventUpdatePayload, ScheduleMeetingPayload } from '@/types'

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

export function useUpdateCalendarEvent() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CalendarEventUpdatePayload }) =>
      graphApi.updateEvent(id, payload),

    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: [CALENDAR_KEY] })

      const snapshots = qc.getQueriesData<CalendarEvent[]>({ queryKey: [CALENDAR_KEY] })

      qc.setQueriesData<CalendarEvent[]>({ queryKey: [CALENDAR_KEY] }, (old) => {
        if (!old) return old
        return old.map((event) => {
          if (event.id !== id) return event
          return {
            ...event,
            ...(payload.subject !== undefined ? { subject: payload.subject } : {}),
            ...(payload.start_iso !== undefined
              ? { start: { ...event.start, dateTime: payload.start_iso } }
              : {}),
            ...(payload.end_iso !== undefined
              ? { end: { ...event.end, dateTime: payload.end_iso } }
              : {}),
          }
        })
      })

      return { snapshots }
    },

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CALENDAR_KEY] })
      toast('Meeting updated', { variant: 'success' })
    },

    onError: (err: Error, _vars, context) => {
      if (context?.snapshots) {
        for (const [queryKey, data] of context.snapshots) {
          qc.setQueryData(queryKey, data)
        }
      }
      const msg =
        err instanceof ApiError && err.status === 400
          ? 'Connect your Microsoft account to update meetings'
          : 'Could not update meeting'
      toast(msg, { variant: 'error' })
    },
  })
}

export function useDeleteCalendarEvent() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (eventId: string) => graphApi.deleteEvent(eventId),

    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [CALENDAR_KEY] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      toast('Meeting deleted', { variant: 'success' })
    },

    onError: (err: Error) => {
      const msg =
        err instanceof ApiError && err.status === 400
          ? 'Connect your Microsoft account to delete meetings'
          : 'Could not delete meeting'
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
