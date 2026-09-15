import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi, type CreateLeadPayload } from '@/api/leads'
import { useLeadsStore } from '@/store/leadsStore'
import { useUIStore } from '@/store/uiStore'
import { PAGE_SIZE } from '@/lib/constants'
import type { Lead } from '@/types'

export const LEADS_KEY = 'leads'
export const LEAD_KEY = 'lead'

function normalizeLeads(response: import('@/api/leads').LeadsResponse) {
  return {
    ...response,
    data: response.data.map((lead) => ({
      ...lead,
      score: lead.score ?? 0,
      score_factors: lead.score_factors ?? [],
    })),
  }
}

/** Scope applied on top of the shared filter/sort/page store — see LeadListView. */
export interface LeadScope {
  /** Comma-separated `leads.source` values (GOV_LEAD_SOURCES for Public Leads). */
  sources?: string
  /** Leads assigned to or created by the caller; the id is resolved server-side. */
  mine?: boolean
  /** Public Leads queue: hide leads once assigned_to is set (never deleted). */
  unassigned_only?: boolean
}

export function useLeads(scope: LeadScope = {}) {
  const { filters, sortBy, sortDir, page } = useLeadsStore()

  return useQuery({
    queryKey: [LEADS_KEY, scope, filters, sortBy, sortDir, page],
    queryFn: () => leadsApi.list({
      ...scope,
      search: filters.search || undefined,
      states: filters.states.length > 0 ? filters.states.join(',') : undefined,
      lead_types: filters.leadTypes.length > 0 ? filters.leadTypes.join(',') : undefined,
      min_score: filters.minScore > 0 ? filters.minScore : undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      page,
      page_size: PAGE_SIZE,
    }),
    select: normalizeLeads,
    staleTime: 30_000,
  })
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: [LEAD_KEY, id],
    queryFn: () => leadsApi.get(id!),
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateLead() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (body: CreateLeadPayload) => leadsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [LEADS_KEY] })
      toast('Lead added', { variant: 'success' })
    },
    // Surface the server's `detail` (carried on error.message by client.ts's
    // ApiError) instead of swallowing it — the whole demo failure was invisible
    // because this description was blank. `instanceof Error` not `ApiError`:
    // ApiError is not exported from client.ts, and `.message` carries the detail
    // either way.
    onError: (e) => toast('Failed to add lead', {
      variant: 'error',
      description: e instanceof Error ? e.message : 'Try again.',
    }),
  })
}

export function useUpdateLead() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Lead> }) => leadsApi.patch(id, body),
    onSuccess: (updated) => {
      qc.setQueryData([LEAD_KEY, updated.id], updated)
      qc.invalidateQueries({ queryKey: [LEADS_KEY] })
    },
    onError: (e) => toast('Update failed', {
      variant: 'error',
      description: e instanceof Error ? e.message : 'Could not update lead. Try again.',
    }),
  })
}

export function useAllLeads() {
  return useQuery({
    queryKey: [LEADS_KEY, 'all'],
    queryFn: () => leadsApi.list({ page: 1, page_size: 100 }),
    select: normalizeLeads,
    staleTime: 60_000,
  })
}

export function useDeleteLead() {
  const queryClient = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: (id: string) => leadsApi.deleteLead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LEADS_KEY] })
      toast('Lead deleted', { variant: 'success' })
    },
    onError: (e) =>
      toast('Failed to delete lead', {
        variant: 'error',
        description: e instanceof Error ? e.message : 'Try again.',
      }),
  })
}

export function useAssignLeadToCrm() {
  const qc = useQueryClient()
  const toast = useUIStore((s) => s.toast)

  return useMutation({
    mutationFn: leadsApi.assignToCrm,
    onSuccess: (updated) => {
      qc.setQueryData([LEAD_KEY, updated.id], updated)
      qc.invalidateQueries({ queryKey: [LEADS_KEY] })
      toast('Lead assigned', { variant: 'success' })
    },
    onError: () => toast('Assignment failed', { variant: 'error' }),
  })
}

