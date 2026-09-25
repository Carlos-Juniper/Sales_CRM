import { Badge } from '@/components/ui/badge'
import type { CommissionInstallmentStatus } from '@/types/commissions'

const STATUS_PRESENTATION: Record<
  CommissionInstallmentStatus,
  { label: string; variant: 'green' | 'amber' | 'blue' | 'zinc' | 'outline' }
> = {
  paid: { label: 'Paid', variant: 'green' },
  due: { label: 'Due', variant: 'amber' },
  upcoming: { label: 'Upcoming', variant: 'blue' },
  cancelled: { label: 'Cancelled', variant: 'zinc' },
  pending_billing_data: { label: 'Pending billing data', variant: 'outline' },
}

export function InstallmentStatusBadge({ status }: { status: CommissionInstallmentStatus }) {
  const presentation = STATUS_PRESENTATION[status]
  return (
    <Badge variant={presentation.variant} className="whitespace-nowrap">
      {presentation.label}
    </Badge>
  )
}
