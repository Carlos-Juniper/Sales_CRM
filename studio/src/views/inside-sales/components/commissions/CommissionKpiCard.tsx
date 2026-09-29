import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface CommissionKpiCardProps {
  label: string
  value: string
  dotColor: string
  hint?: string
}

export function CommissionKpiCard({ label, value, dotColor, hint }: CommissionKpiCardProps) {
  return (
    <Card className="flex-1 min-w-[160px]">
      <CardContent className="p-0">
        <div className="flex items-center gap-1.5 px-4 py-3">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dotColor)} />
          <span className="text-xs font-semibold tracking-widest text-[hsl(var(--muted-fg))] uppercase">
            {label}
          </span>
        </div>
        <div className="border-t border-[hsl(var(--border))]" />
        <div className="px-5 py-4">
          <p className="text-3xl font-bold text-[hsl(var(--fg))]">{value}</p>
          {hint && (
            <p className="text-xs text-[hsl(var(--muted-fg))] mt-1">{hint}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
