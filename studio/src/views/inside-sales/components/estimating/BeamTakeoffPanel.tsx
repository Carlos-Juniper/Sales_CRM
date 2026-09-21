// ---------------------------------------------------------------------------
// Beam / Attentive automated takeoff — ordering and QA.
//
// The order is deliberately two steps. Creating the draft is free and returns
// what Attentive will charge; ordering it spends that money. Attentive confirmed
// generation needs no click inside their portal, which means the click that used
// to bill is now ours — so the cost is shown before the button that commits to
// it, and the server refuses a second order for the same request.
//
// Beam's measurements are a starting point, not an answer. Estimators still
// correct lake banks, mulch beds with no turf border, and hard edging against
// black asphalt, which Attentive's edge detection misses — that is what the
// link into Attentive's own editor is for. It carries no credentials: each
// estimator signs in with their own Beam login, so Attentive records who made
// the correction. Corrections come back as an output_edit callback.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, Satellite } from 'lucide-react'
import type { BeamRequest } from '@/api/estimating'
import type { MaintenanceEstimate } from '@/types/estimating'
import {
  useAcceptBeamChanges,
  useBeamTakeoff,
  useCreateBeamDraft,
  useGenerateBeamTakeoff,
} from '@/hooks/useBeamTakeoff'
import { useToast } from './useToast'

const STATUS_LABEL: Record<BeamRequest['status'], string> = {
  unordered: 'Not ordered',
  draft: 'Draft — not ordered',
  queued: 'Queued at Attentive',
  in_progress: 'Measuring',
  investigating: 'Attentive is investigating',
  resubmitted: 'Resubmitted',
  completed: 'Measurements delivered',
  failed: 'Failed',
}

function formatCost(cents: number | null): string {
  if (cents === null) return 'cost unavailable'
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatEta(seconds: number | null): string | null {
  if (seconds === null) return null
  const hours = Math.round(seconds / 3600)
  return hours >= 1 ? `~${hours}h` : `~${Math.max(1, Math.round(seconds / 60))}m`
}

export function BeamTakeoffPanel({ estimate }: { estimate: MaintenanceEstimate }) {
  const { show } = useToast()
  const { data: request, isLoading } = useBeamTakeoff(estimate.id)
  const createDraft = useCreateBeamDraft(estimate.id)
  const generate = useGenerateBeamTakeoff(estimate.id)
  const acceptChanges = useAcceptBeamChanges(estimate.id)
  const [address, setAddress] = useState('')

  // Pre-fill address from a broken draft so the retry input is ready to go.
  useEffect(() => {
    if (request && !request.attentiveRequestId && request.address) {
      setAddress(request.address)
    }
  }, [request?.id])

  async function handleCreateDraft() {
    try {
      await createDraft.mutateAsync(address.trim())
      show('Draft created — review the cost before ordering')
    } catch {
      show('Could not create the draft — check the address and try again')
    }
  }

  async function handleGenerate() {
    if (!request) return
    try {
      await generate.mutateAsync(request.id)
      show('Takeoff ordered')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Order failed — nothing was charged')
    }
  }

  const appliedOutputs = (request?.outputs ?? []).filter((o) => o.appliedToSectionId)
  const eta = request ? formatEta(request.etaSeconds) : null
  // Draft was inserted locally but the Attentive call failed — no remote request exists.
  const isDraftBroken = !!request && !request.attentiveRequestId

  async function handleRetryDraft() {
    if (!address.trim()) return
    try {
      await createDraft.mutateAsync(address.trim())
      show('Draft created — review the cost before ordering')
    } catch {
      show('Could not create the draft — check the address and try again')
    }
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-4 py-3">
        <Satellite className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
        <h4 className="text-sm font-semibold text-[hsl(var(--fg))]">Automated takeoff (Beam)</h4>
        {request && (
          <span className="ml-auto rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-[11px] text-[hsl(var(--muted-fg))]">
            {STATUS_LABEL[request.status]}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {estimate.takeoffChangedAt && (
          <div className="flex items-start gap-2.5 rounded-[10px] bg-[#fef3c7] px-3.5 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#92400e]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[#92400e]">
                Beam redelivered measurements after this estimate was priced. Nothing was
                overwritten — review the numbers, then accept.
              </p>
            </div>
            <button
              type="button"
              onClick={() => request && void acceptChanges.mutateAsync(request.id)}
              disabled={!request || acceptChanges.isPending}
              className="h-7 flex-shrink-0 cursor-pointer rounded-lg border border-[#92400e] px-2.5 text-[11px] font-medium text-[#92400e] disabled:cursor-default disabled:opacity-60"
            >
              Accept
            </button>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-[hsl(var(--muted-fg))]">Loading takeoff…</p>
        ) : !request || isDraftBroken ? (
          <div className="flex flex-col gap-2">
            {isDraftBroken && (
              <p className="text-xs text-[#b91c1c]">
                Draft failed to reach Attentive. Enter the address below to try again.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-[240px] flex-1 flex-col text-[11px] text-[hsl(var(--muted-fg))]">
                Service address
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="1 Main St, Orlando, FL"
                  aria-label="Service address"
                  className="mt-0.5 h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 text-sm text-[hsl(var(--fg))] outline-none focus:ring-2 focus:ring-[#bfdbfe]"
                />
              </label>
              <button
                type="button"
                onClick={() => void (isDraftBroken ? handleRetryDraft() : handleCreateDraft())}
                disabled={
                  (!isDraftBroken && !address.trim()) || createDraft.isPending
                }
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs font-medium text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))] disabled:cursor-default disabled:opacity-60"
              >
                {createDraft.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isDraftBroken ? 'Try again' : 'Create draft'}
              </button>
              <p className="w-full text-[11px] text-[hsl(var(--muted-fg))]">
                Creating a draft is free. You'll see the exact cost before ordering.
              </p>
            </div>
          </div>
        ) : (
          <>
            {!request.submittedAt && request.attentiveRequestId && (
              <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-[hsl(var(--muted))] px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[hsl(var(--fg))]">
                    {formatCost(request.costCents)}
                    {eta && (
                      <span className="ml-2 text-xs font-normal text-[hsl(var(--muted-fg))]">
                        delivered in {eta}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-fg))]">
                    Ordering charges this to Juniper's Attentive account.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={generate.isPending}
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-[#2E7D52] px-3.5 text-xs font-medium text-white hover:bg-[#276a46] disabled:cursor-default disabled:opacity-60"
                >
                  {generate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Order takeoff
                </button>
              </div>
            )}

            {request.editorUrl && (
              <a
                href={request.editorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Beam
              </a>
            )}

            {appliedOutputs.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-[hsl(var(--muted-fg))]">
                  Applied measurements
                </p>
                <ul className="mt-1 divide-y divide-[hsl(var(--border))] text-xs">
                  {appliedOutputs.map((o) => (
                    <li key={o.id} className="flex justify-between py-1.5">
                      <span className="text-[hsl(var(--fg))]">{o.featureName}</span>
                      <span className="text-[hsl(var(--muted-fg))]">
                        {o.appliedValue?.toLocaleString()} {o.appliedUnit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {request.unmapped.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-[hsl(var(--muted-fg))]">
                  Not applied — no mapping for these features. Enter them by hand.
                </p>
                <p className="mt-1 text-xs text-[hsl(var(--fg))]">
                  {request.unmapped.map((u) => u.featureName).join(', ')}
                </p>
              </div>
            )}

            {request.syncError && (
              <p className="text-xs text-[#b91c1c]">{request.syncError}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
