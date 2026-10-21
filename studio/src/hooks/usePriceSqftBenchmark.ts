import { useQuery } from '@tanstack/react-query'
import { estimatingApi } from '@/api/estimating'
import { parsePriceSqftBenchmark } from '@/lib/estimating/pricePerSqft'

export function usePriceSqftBenchmark(estimateId: string | null) {
  return useQuery({
    queryKey: ['price-sqft-benchmark', estimateId],
    enabled: estimateId !== null,
    retry: false,
    queryFn: async () => {
      const raw = await estimatingApi.priceSqftBenchmark(estimateId as string)
      return parsePriceSqftBenchmark(raw)
    },
  })
}
