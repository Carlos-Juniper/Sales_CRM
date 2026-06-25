import { useQuery } from '@tanstack/react-query'
import { fetchConnections } from '@/api/connections'

export function useConnections() {
  return useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
  })
}
