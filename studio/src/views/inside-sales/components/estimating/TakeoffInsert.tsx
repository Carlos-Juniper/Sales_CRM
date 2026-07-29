// ---------------------------------------------------------------------------
// Takeoff Insert (Handoff 10) — maintenance-only.
//
// The SINGLE artifact Estimating hands to the CRM (the salesperson — a
// person, not a system) for maintenance estimates: the scanned/hand-drawn
// property boundary map plus computed acreage stats. Explicitly NOT a
// proposal, quote document, or pricing-letter generator — Sales assembles
// the customer-facing proposal in the CRM from this insert plus the
// approved estimate (Maintenance Review edit; BRD I-6.8; E2E Phase E).
//
// Boundary interpretation stays manual by design: "A LOT OF HUMAN
// INTERPRETATION IS NEEDED" — hence the permanent "Manual takeoff — human
// interpreted" badge. Full boundary automation is explicitly not wanted.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { Download, FileX, Image as ImageIcon, Map, Paperclip, PenTool } from 'lucide-react'
import { estimatingApi } from '@/api/estimating'
import { acresFromSqft } from '@/lib/estimating/calc'
import type { MaintenanceEstimate } from '@/types/estimating'
import { useEstimatingShell } from './useEstimatingShell'
import { useToast } from './useToast'

/**
 * Turf-area / curb-miles takeoff metadata. Source is an OPEN ITEM (Handoff 10
 * §4) — today there is no persisted takeoff-metadata record, so both render
 * as "—" until the backend field lands. Square footage / acreage always
 * derive from the estimate's sections (never stored).
 */
interface TakeoffMeta {
  turfAreaAcres: number | null
  curbMiles: number | null
}

const EMPTY_META: TakeoffMeta = { turfAreaAcres: null, curbMiles: null }

interface UploadedScan {
  fileName: string
  /** Object URL for preview. Persisting the upload is future scope. */
  url: string
}

function formatAcres(acres: number): string {
  return `${acres.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ac`
}

export function TakeoffInsert() {
  const { openEstimate, setOpenEstimate } = useEstimatingShell()

  if (!openEstimate || openEstimate.estimateType !== 'maintenance') {
    // The tab registry already hides this tab for install estimates; this
    // guard also covers queue-level browsing (no estimate open yet).
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
          <ImageIcon className="h-6 w-6 text-[hsl(var(--muted-fg))]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[hsl(var(--fg))]">Takeoff insert</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-fg))]">
            Open a maintenance estimate from the queue to build its takeoff insert.
          </p>
        </div>
      </div>
    )
  }

  return <TakeoffInsertBody estimate={openEstimate} setOpenEstimate={setOpenEstimate} />
}

function TakeoffInsertBody({
  estimate,
  setOpenEstimate,
}: {
  estimate: MaintenanceEstimate
  setOpenEstimate: (estimate: MaintenanceEstimate) => void
}) {
  const { show } = useToast()
  const [scan, setScan] = useState<UploadedScan | null>(null)
  const [handingOff, setHandingOff] = useState(false)

  // Open item (Handoff 10 §4): no persisted source for turf/curb yet.
  const meta = EMPTY_META

  // Derived, never stored: acreage = sqft / 43,560.
  const totalSqft = estimate.sections.reduce((sum, s) => sum + s.squareFeet, 0)
  const totalAcres = acresFromSqft(totalSqft)
  const handedOff = estimate.status === 'handed_back'

  // Release the preview object URL when replaced/unmounted.
  useEffect(() => {
    return () => {
      if (scan) URL.revokeObjectURL(scan.url)
    }
  }, [scan])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setScan({ fileName: file.name, url: URL.createObjectURL(file) })
    show('Scanned map uploaded')
    e.target.value = ''
  }

  /** Export the insert (scan reference + acreage stats) as a file download. */
  function handleDownload() {
    const lines = [
      `Takeoff insert — ${estimate.name}`,
      `Aspire opportunity: ${estimate.aspireNumber ?? '—'}`,
      `Scanned map: ${scan?.fileName ?? 'not uploaded'}`,
      `Total acreage: ${formatAcres(totalAcres)}`,
      `Square footage: ${totalSqft.toLocaleString()}`,
      `Turf area: ${meta.turfAreaAcres !== null ? formatAcres(meta.turfAreaAcres) : '—'}`,
      `Curb miles: ${meta.curbMiles !== null ? `${meta.curbMiles.toLocaleString()} mi` : '—'}`,
      'Manual takeoff — human interpreted. Manually drawn & QA\'d by estimator.',
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `takeoff-insert-${estimate.aspireNumber ?? estimate.id}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
    show('Takeoff insert downloaded')
  }

  /**
   * Attach the insert to the estimate/opportunity and advance handoff state.
   * TODO(handoff-08 / backend): persist the scanned-map file as an estimate
   * attachment and coordinate the exact status transition with the Approval &
   * Handoff flow's handback. Today this advances the estimate to
   * `handed_back` via the standard PATCH endpoint.
   */
  async function handleAttachHandOff() {
    setHandingOff(true)
    try {
      const updated = await estimatingApi.update(estimate.id, { status: 'handed_back' })
      setOpenEstimate(updated as MaintenanceEstimate)
      show('Takeoff insert attached — handed off to the CRM')
    } catch {
      show('Hand-off failed — try again')
    } finally {
      setHandingOff(false)
    }
  }

  const stats: Array<{ label: string; value: string }> = [
    { label: 'Total acreage', value: formatAcres(totalAcres) },
    { label: 'Square footage', value: totalSqft.toLocaleString() },
    { label: 'Turf area', value: meta.turfAreaAcres !== null ? formatAcres(meta.turfAreaAcres) : '—' },
    { label: 'Curb miles', value: meta.curbMiles !== null ? `${meta.curbMiles.toLocaleString()} mi` : '—' },
  ]

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
      {/* Header + actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[hsl(var(--fg))]">Takeoff insert</h3>
          <p className="mt-1 text-xs text-[hsl(var(--muted-fg))]">
            Estimating's only output to the CRM — the scanned property image + acreage. The
            proposal packet is built by the CRM, not here.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-xs text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          <button
            type="button"
            onClick={handleAttachHandOff}
            disabled={handedOff || handingOff}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-[#2E7D52] px-3.5 text-xs font-medium text-white hover:bg-[#276a46] disabled:cursor-default disabled:opacity-60"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {handedOff ? 'Handed off' : handingOff ? 'Handing off…' : 'Attach & hand off'}
          </button>
        </div>
      </div>

      {/* Map card */}
      <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
        <div
          className="relative flex aspect-[16/8] items-center justify-center border-b border-[hsl(var(--border))]"
          style={
            scan
              ? undefined
              : {
                  background:
                    'repeating-linear-gradient(45deg,#eef2ef,#eef2ef 14px,#e6ebe7 14px,#e6ebe7 28px)',
                }
          }
        >
          {scan ? (
            <img
              src={scan.url}
              alt="Scanned property boundary map"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="text-center text-[hsl(var(--muted-fg))]">
              <Map className="mx-auto h-8 w-8" />
              <p className="mt-2 text-[13px] font-medium">Scanned property boundary map</p>
              <p className="mt-0.5 text-[11px]">
                Manually drawn &amp; QA'd by estimator · Upload the corrected scan below
              </p>
            </div>
          )}
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[rgba(17,24,39,0.82)] px-2.5 py-1 text-[11px] text-white">
            <PenTool className="h-3 w-3" />
            Manual takeoff — human interpreted
          </span>
        </div>

        {/* Upload row */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--border))] px-4 py-2.5">
          <p className="min-w-0 truncate text-[11px] text-[hsl(var(--muted-fg))]">
            {scan ? scan.fileName : 'No scan uploaded yet'}
          </p>
          <label
            htmlFor="takeoff-scan-upload"
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 text-[11px] font-medium text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
          >
            <ImageIcon className="h-3 w-3" />
            {scan ? 'Replace scan' : 'Upload scan'}
          </label>
          <input
            id="takeoff-scan-upload"
            type="file"
            accept="image/*"
            aria-label="Upload scanned map"
            className="sr-only"
            onChange={handleFileChange}
          />
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-[11px] text-[hsl(var(--muted-fg))]">{stat.label}</p>
              <p className="mt-0.5 text-lg font-bold text-[hsl(var(--fg))]">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Hard business rule — the maintenance tab never generates a proposal */}
      <div className="flex items-start gap-2.5 rounded-[10px] bg-[hsl(var(--muted))] px-3.5 py-3">
        <FileX className="mt-0.5 h-4 w-4 flex-shrink-0 text-[hsl(var(--muted-fg))]" />
        <p className="text-xs text-[hsl(var(--muted-fg))]">
          No proposal, quote document, or pricing letter is generated on the maintenance tab.
          Sales assembles the customer-facing proposal in the CRM from this insert plus the
          approved estimate.
        </p>
      </div>
    </div>
  )
}
