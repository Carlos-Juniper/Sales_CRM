import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { useUpdateCalendarEvent, useDeleteCalendarEvent, useCalendarEvents } from '@/hooks/useCalendar'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { createWrapper, makeUser } from '../utils'
import type { CalendarEvent, CalendarEventUpdatePayload } from '@/types'

const mockEvent: CalendarEvent = {
  id: 'evt1',
  subject: 'Site visit — Palm Grove HOA',
  start: { dateTime: '2026-07-14T14:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-07-14T15:00:00.0000000', timeZone: 'UTC' },
  attendees: [],
  isOrganizer: true,
  showAs: 'busy',
}

beforeEach(() => {
  useAuthStore.setState({ user: makeUser(), isLoading: false })
  server.use(http.get('/api/calendar/events', () => HttpResponse.json([mockEvent])))
})

describe('useUpdateCalendarEvent', () => {
  it('fires PATCH /api/calendar/events/:id with the payload', async () => {
    let capturedBody: unknown
    server.use(
      http.patch('/api/calendar/events/evt1', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ...mockEvent, subject: 'Updated Subject' })
      }),
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateCalendarEvent(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'evt1', payload: { subject: 'Updated Subject' } })
    })

    expect((capturedBody as CalendarEventUpdatePayload).subject).toBe('Updated Subject')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('toasts "Meeting updated" on success', async () => {
    server.use(
      http.patch('/api/calendar/events/evt1', () => HttpResponse.json({ ...mockEvent })),
    )
    const toastSpy = vi.spyOn(useUIStore.getState(), 'toast')

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateCalendarEvent(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ id: 'evt1', payload: { subject: 'x' } })
    })

    expect(toastSpy).toHaveBeenCalledWith('Meeting updated', { variant: 'success' })
    toastSpy.mockRestore()
  })

  it('toasts the connect message on 400 error', async () => {
    server.use(
      http.patch('/api/calendar/events/evt1', () =>
        HttpResponse.json({ detail: 'Not connected' }, { status: 400 }),
      ),
    )
    const toastSpy = vi.spyOn(useUIStore.getState(), 'toast')

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateCalendarEvent(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'evt1', payload: { subject: 'x' } })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toastSpy).toHaveBeenCalledWith(
      'Connect your Microsoft account to update meetings',
      { variant: 'error' },
    )
    toastSpy.mockRestore()
  })

  it('toasts generic error on non-400 failure', async () => {
    server.use(
      http.patch('/api/calendar/events/evt1', () =>
        HttpResponse.json({ error: 'Server Error' }, { status: 502 }),
      ),
    )
    const toastSpy = vi.spyOn(useUIStore.getState(), 'toast')

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateCalendarEvent(), { wrapper })

    await act(async () => {
      result.current.mutate({ id: 'evt1', payload: { subject: 'x' } })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toastSpy).toHaveBeenCalledWith('Could not update meeting', { variant: 'error' })
    toastSpy.mockRestore()
  })

  describe('optimistic update', () => {
    it('rolls back the cache on error', async () => {
      const START = '2026-07-14T00:00:00Z'
      const END = '2026-07-21T00:00:00Z'

      server.use(
        http.get('/api/calendar/events', () => HttpResponse.json([mockEvent])),
        http.patch('/api/calendar/events/evt1', () =>
          HttpResponse.json({ error: 'Server Error' }, { status: 502 }),
        ),
      )

      const { wrapper } = createWrapper()

      const { result: eventsResult } = renderHook(
        () => useCalendarEvents(START, END),
        { wrapper },
      )
      await waitFor(() => expect(eventsResult.current.isSuccess).toBe(true))

      const { result } = renderHook(() => useUpdateCalendarEvent(), { wrapper })

      await act(async () => {
        result.current.mutate({ id: 'evt1', payload: { subject: 'Optimistic Title' } })
      })

      await waitFor(() => expect(result.current.isError).toBe(true))

      expect(eventsResult.current.data?.find((e) => e.id === 'evt1')?.subject).toBe(
        'Site visit — Palm Grove HOA',
      )
    })
  })
})

describe('useDeleteCalendarEvent', () => {
  it('fires DELETE /api/calendar/events/:id', async () => {
    let deletedId: string | undefined
    server.use(
      http.delete('/api/calendar/events/:id', ({ params }) => {
        deletedId = params.id as string
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteCalendarEvent(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('evt1')
    })

    expect(deletedId).toBe('evt1')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('toasts "Meeting deleted" on success', async () => {
    server.use(
      http.delete('/api/calendar/events/:id', () => new HttpResponse(null, { status: 204 })),
    )
    const toastSpy = vi.spyOn(useUIStore.getState(), 'toast')

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteCalendarEvent(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('evt1')
    })

    expect(toastSpy).toHaveBeenCalledWith('Meeting deleted', { variant: 'success' })
    toastSpy.mockRestore()
  })

  it('invalidates activity queries on success', async () => {
    server.use(
      http.delete('/api/calendar/events/:id', () => new HttpResponse(null, { status: 204 })),
    )

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useDeleteCalendarEvent(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('evt1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['activity'] }))
  })

  it('toasts the connect message on 400 error', async () => {
    server.use(
      http.delete('/api/calendar/events/:id', () =>
        HttpResponse.json({ detail: 'Not connected' }, { status: 400 }),
      ),
    )
    const toastSpy = vi.spyOn(useUIStore.getState(), 'toast')

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteCalendarEvent(), { wrapper })

    await act(async () => {
      result.current.mutate('evt1')
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toastSpy).toHaveBeenCalledWith(
      'Connect your Microsoft account to delete meetings',
      { variant: 'error' },
    )
    toastSpy.mockRestore()
  })

  it('toasts generic error on non-400 failure', async () => {
    server.use(
      http.delete('/api/calendar/events/:id', () =>
        HttpResponse.json({ error: 'Server Error' }, { status: 502 }),
      ),
    )
    const toastSpy = vi.spyOn(useUIStore.getState(), 'toast')

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteCalendarEvent(), { wrapper })

    await act(async () => {
      result.current.mutate('evt1')
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(toastSpy).toHaveBeenCalledWith('Could not delete meeting', { variant: 'error' })
    toastSpy.mockRestore()
  })
})
