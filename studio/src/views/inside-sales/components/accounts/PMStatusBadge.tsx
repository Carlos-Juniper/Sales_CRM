import { Badge } from '@/components/ui/badge'
import { PM_STATUS_VARIANTS } from '@/lib/constants'
import type { PMStatus } from '@/types/accounts'

const PM_VARIANT = PM_STATUS_VARIANTS

interface PMStatusBadgeProps {
  status: PMStatus
}

export function PMStatusBadge({ status }: PMStatusBadgeProps) {
  const variant = (PM_VARIANT[status] ?? 'secondary') as Parameters<typeof Badge>[0]['variant']
  return (
    <Badge variant={variant} data-status={status}>
      {status}
    </Badge>
  )
}
