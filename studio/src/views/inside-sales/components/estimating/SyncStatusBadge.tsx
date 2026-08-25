/**
 * SyncStatusBadge — the user-facing identifier chip.
 *
 * Renders displayRef() (the single source of the estimate identifier) and, when
 * the Aspire push is pending/failed, a "Retry sync" affordance that re-triggers
 * the best-effort background push. Used on the queue card and the editor header.
 */
import { useState } from 'react'
import { displayRef, type RefLike } from '@/lib/estimating/displayRef'
import { estimatingApi } from '@/api/estimating'

interface Props {
  estimate: RefLike
  /** Called after a successful retry request (e.g. to refetch the estimate). */
  onRetried?: () => void
}

const STATE_STYLES: Record<'synced' | 'pending' | 'failed', string> = {
  synced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
}

export function SyncStatusBadge({ estimate, onRetried }: Props) {
  const ref = displayRef(estimate)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState(false)
  const canRetry = ref.state === 'pending' || ref.state === 'failed'

  async function handleRetry() {
    setRetrying(true)
    setRetryError(false)
    try {
      await estimatingApi.retryAspireSync(estimate.id)
      onRetried?.()
    } catch {
      // Best-effort — surface inline so the estimator can try again; never throw.
      setRetryError(true)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        data-testid="sync-status-badge"
        data-state={ref.state}
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_STYLES[ref.state]}`}
      >
        {ref.text}
      </span>
      {canRetry && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="text-xs font-medium text-blue-600 underline-offset-2 hover:underline disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry sync'}
        </button>
      )}
      {retryError && (
        <span role="alert" className="text-xs text-red-600">
          Retry failed — try again
        </span>
      )}
    </span>
  )
}
