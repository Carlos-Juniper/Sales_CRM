/**
 * LostTransition — mark an estimate Lost with a captured reason.
 *
 * The reason (→ Aspire OpportunityLostReasonID) is required so the terminal
 * write-back carries it. Renders nothing once the estimate is already terminal
 * (won/lost). On confirm it PATCHes status=lost + lostReasonId; the backend fires
 * the best-effort Aspire write-back.
 */
import { useState } from 'react'
import type { EstimateStatus } from '@/types/estimating'
import { estimatingApi } from '@/api/estimating'
import { LostReasonSelect } from './AspirePickers'

interface Props {
  estimateId: string
  status: EstimateStatus
  /** Called after the estimate is successfully marked lost. */
  onLost?: () => void
}

export function LostTransition({ estimateId, status, onLost }: Props) {
  const [open, setOpen] = useState(false)
  const [reasonId, setReasonId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  // Terminal estimates can't transition again.
  if (status === 'won' || status === 'lost') return null

  async function handleConfirm() {
    if (reasonId == null) return
    setSaving(true)
    setError(false)
    try {
      await estimatingApi.update(estimateId, { status: 'lost', lostReasonId: reasonId })
      onLost?.()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        Mark as Lost
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3">
      <LostReasonSelect label="Lost reason" value={reasonId} onChange={setReasonId} />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          Could not mark lost — try again.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={reasonId == null || saving}
          className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Marking…' : 'Confirm Lost'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
