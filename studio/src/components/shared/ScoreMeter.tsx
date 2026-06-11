import { scoreToColor } from '@/lib/utils'
import './ScoreMeter.css'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ScoreFactor } from '@/types'

interface ScoreMeterProps {
  score: number | null
  factors?: ScoreFactor[] | null
  showLabel?: boolean
  size?: 'sm' | 'md'
}

export function ScoreMeter({ score, factors, showLabel = true, size = 'md' }: ScoreMeterProps) {
  if (score === null) return null
  const color = scoreToColor(score)
  const barHeight = size === 'sm' ? 'h-1.5' : 'h-2'

  const bar = (
    <div className="flex items-center gap-2 w-full">
      <div className={`flex-1 bg-[hsl(var(--border))] rounded-full overflow-hidden ${barHeight}`}>
        <div
          className="h-full rounded-full transition-all duration-500 score-meter-fill"
          style={{ '--meter-width': `${score}%`, '--meter-color': color } as React.CSSProperties}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-medium tabular-nums score-meter-label" style={{ '--meter-color': color } as React.CSSProperties}>
          {score}
        </span>
      )}
    </div>
  )

  if (!factors?.length) return bar

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help w-full">{bar}</div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] p-3">
        <p className="font-semibold text-xs mb-2">Score breakdown</p>
        <div className="space-y-1.5">
          {factors.map((f) => (
            <div key={f.name} className="flex items-center justify-between gap-4">
              <span className="text-xs">{f.name}</span>
              <span className="text-xs font-medium tabular-nums">{f.score}/{f.max}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
