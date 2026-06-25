import { useQuery } from '@tanstack/react-query'
import { fetchLeadActivity } from '@/api/activity'

export function useLeadActivity(leadId: string) {
  return useQuery({
    queryKey: ['activity', leadId],
    queryFn: () => fetchLeadActivity(leadId),
    enabled: !!leadId,
  })
}
