// Rush display shared by the intake forms, the estimate queue, and estimate
// detail. The badge reads the server flag only. The note is the intake hint
// for a date the user just picked; it is not how the queue decides Rush.

import { isRushWindowDate } from '@/lib/estimating/sla'

/** Queue / detail chip. Same amber tokens as the Badge `amber` variant, sized like the queue priority chips. */
export function RushBadge() {
  return (
    <span
      data-testid="rush-badge"
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
    >
      Rush
    </span>
  )
}

/**
 * Inline intake note. Shown only when the chosen date is inside the SLA
 * window (today through windowDays − 1). Hidden when the field is empty,
 * the date is on/after the window, or the date is already past.
 */
export function RushWindowNote({ date, windowDays }: { date: string; windowDays: number }) {
  if (!date || !isRushWindowDate(date, windowDays)) return null
  return (
    <p
      data-testid="rush-window-note"
      className="text-[10px] leading-snug text-amber-800 dark:text-amber-300"
    >
      This date is inside the SLA window, so the estimate will be flagged as a rush job.
    </p>
  )
}
