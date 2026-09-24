import { useQuery } from '@tanstack/react-query'
import { usersApi } from '@/api/bids'

/**
 * The only place the proposal roster picker asks for sales reps.
 *
 * Today that is GET /api/users?role=sales. The sales-role split (R1) may
 * change how "all sales roles" is requested — update this function, not the
 * settings screens.
 */
export function fetchSalesRepOptions() {
  return usersApi.list('sales')
}

export function useSalesRepOptions(enabled = true) {
  return useQuery({
    queryKey: ['users', 'proposal-roster-reps'],
    queryFn: fetchSalesRepOptions,
    enabled,
    staleTime: 300_000,
  })
}
