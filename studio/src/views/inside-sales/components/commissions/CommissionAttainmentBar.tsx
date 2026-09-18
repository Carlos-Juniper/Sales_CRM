import { formatCents } from '@/lib/estimating/maintenance'

interface CommissionAttainmentBarProps {
  label: string
  valueCents: number
  maxCents: number
  barColor: string  // Tailwind bg class e.g. 'bg-green-500'
}

export function CommissionAttainmentBar({
  label,
  valueCents,
  maxCents,
  barColor,
}: CommissionAttainmentBarProps) {
  const pct = maxCents > 0 ? Math.min(100, (valueCents / maxCents) * 100) : 0

  return (
    <div className="flex items-center gap-4">
      <span className="w-28 text-xs text-[hsl(var(--muted-fg))] text-right shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-[hsl(var(--muted))] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-[hsl(var(--fg))] whitespace-nowrap shrink-0 w-20 text-right">
        {formatCents(valueCents)}
      </span>
      <span className="text-xs text-[hsl(var(--muted-fg))] whitespace-nowrap shrink-0 w-10 text-right">
        {Math.round(pct)}%
      </span>
    </div>
  )
}
