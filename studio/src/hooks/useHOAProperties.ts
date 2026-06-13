import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hoaPropertiesApi, type CreateHOAPropertyPayload, type PatchHOAPropertyPayload } from '@/api/hoaProperties'
import { useUIStore } from '@/store/uiStore'

export const HOA_KEY = 'hoa-properties'

export interface HOAFilterParams {
  search?: string
  status?: string    // comma-separated
  branch_id?: string // comma-separated
  city?: string      // comma-separated
}

export function useHOAProperties(filters?: HOAFilterParams) {
  return useQuery({
    queryKey: [HOA_KEY, filters ?? {}],
    queryFn: () => hoaPropertiesApi.list(filters ? { ...filters, page_size: 1000 } : { page_size: 1000 }),
    select: (res) => res.data,
    staleTime: 30_000,
  })
}

export function useHOAFilterOptions() {
  return useQuery({
    queryKey: ['hoa-filter-options'],
    queryFn: () => hoaPropertiesApi.filterOptions(),
    staleTime: 5 * 60_000,
  })
}

export function useCreateHOAProperty() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (body: CreateHOAPropertyPayload) => hoaPropertiesApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [HOA_KEY] })
      toast('Property added', { variant: 'success' })
    },
    onError: () => toast('Failed to create property', { variant: 'error' }),
  })
}

export function usePatchHOAProperty() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PatchHOAPropertyPayload }) =>
      hoaPropertiesApi.patch(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [HOA_KEY] }),
    onError: () => toast('Failed to update property', { variant: 'error' }),
  })
}

export function usePromoteHOAProperty() {
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (id: string) => hoaPropertiesApi.promote(id),
    // No cache invalidation needed — promote creates a Lead, not an HOA record change
    onError: () => toast('Failed to create bid', { variant: 'error' }),
  })
}
