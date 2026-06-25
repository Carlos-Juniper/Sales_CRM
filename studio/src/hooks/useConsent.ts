import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchContactConsent, patchContactConsent } from '@/api/compliance'

export function useContactConsent(contactId: string | null) {
  return useQuery({
    queryKey: ['consent', contactId],
    queryFn: () => fetchContactConsent(contactId!),
    enabled: !!contactId,
  })
}

export function usePatchConsent(contactId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (updates: Record<string, boolean | string>) => patchContactConsent(contactId, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consent', contactId] }),
  })
}
