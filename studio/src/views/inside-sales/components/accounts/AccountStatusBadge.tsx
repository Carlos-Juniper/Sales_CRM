import { Badge } from '@/components/ui/badge'
import { HOA_STATUS_VARIANTS } from '@/lib/constants'
import type { HOAStatus } from '@/types/accounts'

// Maps HOA pipeline stage to badge colour variant.
// The test checks outerHTML for colour tokens, so variant names must appear
// in the rendered class string (badgeVariants uses them as class tokens).
const STATUS_VARIANT = HOA_STATUS_VARIANTS

interface AccountStatusBadgeProps {
  status: HOAStatus
}

export function AccountStatusBadge({ status }: AccountStatusBadgeProps) {
  const variant = (STATUS_VARIANT[status] ?? 'secondary') as Parameters<typeof Badge>[0]['variant']
  return (
    <Badge variant={variant} data-status={status}>
      {status}
    </Badge>
  )
}
