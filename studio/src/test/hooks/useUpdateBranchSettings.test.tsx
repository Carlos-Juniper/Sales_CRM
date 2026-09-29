import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { ESTIMATES_KEY } from '@/hooks/useEstimate'
import { useUpdateBranchSettings } from '@/hooks/useBranchSettings'
import { createWrapper } from '@/test/utils'

describe('useUpdateBranchSettings', () => {
  it('refetches estimates after a successful crew-rate save', async () => {
    server.use(
      http.patch('/api/settings/branch/2224', () =>
        HttpResponse.json({ aspireBranchId: 2224, crewRateCentsPerHour: 22_500 }),
      ),
    )
    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateBranchSettings(2224), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ crewRateCentsPerHour: 22_500 })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: [ESTIMATES_KEY] }),
    )
  })

  it('does not refetch estimates when the crew-rate save fails', async () => {
    server.use(
      http.patch('/api/settings/branch/2224', () =>
        HttpResponse.json({ detail: 'forbidden' }, { status: 403 }),
      ),
    )
    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateBranchSettings(2224), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ crewRateCentsPerHour: 22_500 }).catch(() => undefined)
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: [ESTIMATES_KEY] }),
    )
  })
})
