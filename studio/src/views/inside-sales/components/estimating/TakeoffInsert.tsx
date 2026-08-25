// ---------------------------------------------------------------------------
// Takeoff Insert — maintenance-only.
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
//
// The tab is durable:
//   * The uploaded scan persists through the real GCS attachment flow
//     (presign → PUT → confirm) as an estimate-scoped `takeoff_scan`
//     attachment; on mount the stored scan is reloaded via the signed
//     download-url endpoint, so it survives reload.
//   * Turf area & curb miles are manual, editable (blue-cell convention)
//     fields persisted on the estimate. Acreage & sqft stay DERIVED from
//     sections — never stored.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { Download, FileX, Image as ImageIcon, Map, Paperclip, PenTool } from 'lucide-react'
import { estimatingApi } from '@/api/estimating'
import { acresFromSqft } from '@/lib/estimating/calc'
import { useAttachmentUpload } from '@/lib/estimating/useAttachmentUpload'
import type { MaintenanceEstimate } from '@/types/estimating'
import { useEstimatingShell } from './useEstimatingShell'
import { useToast } from './useToast'

interface UploadedScan {
  fileName: string
  /** Preview URL — a local object URL right after upload, or the short-lived
   *  signed GCS GET URL when reloaded from the persisted attachment. */
  url: string
  /** True once the scan is confirmed stored in GCS (durable). */
  persisted: boolean
}

/** Manual takeoff metadata field persisted on the estimate. */
type MetaField = 'turfAreaAcres' | 'curbMiles'

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
  const { upload, state: uploadState } = useAttachmentUpload()

  // ── Manual takeoff metadata ──────────────────────────────────────────────
  //
  // ⚙️  BEAM SLOT — Beam AI automated takeoff (PAUSED) is the
  //     eventual source of turf area & curb miles. When the integration lands
  //     it should PATCH these same estimate fields (turfAreaAcres, curbMiles);
  //     the manual blue-cell inputs below then become estimator overrides.
  //     Do not build any Beam client here until the pause is lifted.
  const [turfDraft, setTurfDraft] = useState(estimate.turfAreaAcres?.toString() ?? '')
  const [curbDraft, setCurbDraft] = useState(estimate.curbMiles?.toString() ?? '')

  const turfAreaAcres = estimate.turfAreaAcres ?? null
  const curbMiles = estimate.curbMiles ?? null

  // Derived, never stored: acreage = sqft / 43,560.
  const totalSqft = estimate.sections.reduce((sum, s) => sum + s.squareFeet, 0)
  const totalAcres = acresFromSqft(totalSqft)
  const handedOff = estimate.status === 'handed_back'
  const uploadBusy =
    uploadState.status === 'presigning' ||
    uploadState.status === 'uploading' ||
    uploadState.status === 'confirming'

  // Reload the persisted scan (survives reload). A locally
  // uploaded scan always wins over the fetched one (functional set guard).
  useEffect(() => {
    let cancelled = false
    async function loadPersistedScan() {
      try {
        const all = await estimatingApi.listAttachments(estimate.id)
        const stored = [...all]
          .reverse()
          .find((a) => a.kind === 'takeoff_scan' && a.downloadable)
        if (!stored || cancelled) return
        const { url } = await estimatingApi.getAttachmentDownloadUrl(estimate.id, stored.id)
        if (cancelled) return
        setScan((prev) => prev ?? { fileName: stored.fileName, url, persisted: true })
      } catch {
        // No persisted scan (or legacy estimate without attachment rows) —
        // the placeholder stays.
      }
    }
    void loadPersistedScan()
    return () => {
      cancelled = true
    }
  }, [estimate.id])

  // Release the preview object URL when replaced/unmounted (signed GCS URLs
  // need no cleanup).
  useEffect(() => {
    return () => {
      if (scan && scan.url.startsWith('blob:')) URL.revokeObjectURL(scan.url)
    }
  }, [scan])

  /**
   * Preview instantly, then persist through the real GCS attachment flow
   * (presign → PUT → confirm) as an estimate-scoped `takeoff_scan` attachment.
   */
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setScan({ fileName: file.name, url: URL.createObjectURL(file), persisted: false })

    const stored = await upload(estimate.id, file, 'takeoff_scan')
    if (stored) {
      setScan((prev) =>
        prev && prev.fileName === file.name ? { ...prev, persisted: true } : prev,
      )
      show('Scanned map saved to the estimate')
    } else {
      show('Scan save failed — try again')
    }
  }

  /** Persist one manual metadata field on blur (only when it changed). */
  async function commitMeta(field: MetaField, raw: string, current: number | null) {
    const trimmed = raw.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    if (value === current) return
    try {
      const updated = await estimatingApi.update(estimate.id, { [field]: value })
      setOpenEstimate(updated as MaintenanceEstimate)
      show('Takeoff details saved')
    } catch {
      show('Save failed — try again')
    }
  }

  /** Export the insert (scan reference + acreage stats) as a file download. */
  function handleDownload() {
    const lines = [
      `Takeoff insert — ${estimate.name}`,
      `Aspire opportunity: ${estimate.aspireNumber ?? '—'}`,
      `Scanned map: ${scan?.fileName ?? 'not uploaded'}`,
      `Total acreage: ${formatAcres(totalAcres)}`,
      `Square footage: ${totalSqft.toLocaleString()}`,
      `Turf area: ${turfAreaAcres !== null ? formatAcres(turfAreaAcres) : '—'}`,
      `Curb miles: ${curbMiles !== null ? `${curbMiles.toLocaleString()} mi` : '—'}`,
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
   * The scan itself is already durable (persisted at upload time);
   * this advances the estimate to `handed_back` via the standard PATCH
   * endpoint (transition-machine enforced server-side).
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

  const scanStatusLabel = uploadBusy
    ? 'Saving scan…'
    : uploadState.status === 'error'
      ? 'Scan save failed — try again'
      : scan?.persisted
        ? 'Saved to estimate'
        : null

  const derivedStats: Array<{ label: string; value: string }> = [
    { label: 'Total acreage', value: formatAcres(totalAcres) },
    { label: 'Square footage', value: totalSqft.toLocaleString() },
  ]

  const metaInputClass =
    'mt-0.5 h-8 w-full rounded-md border border-[#bfdbfe] bg-[#eff6ff] px-2 text-sm font-bold text-[hsl(var(--fg))] outline-none focus:ring-2 focus:ring-[#bfdbfe]'

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
            disabled={handedOff || handingOff || uploadBusy}
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
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 truncate text-[11px] text-[hsl(var(--muted-fg))]">
              {scan ? scan.fileName : 'No scan uploaded yet'}
            </p>
            {scanStatusLabel && (
              <span className="flex-shrink-0 text-[11px] font-medium text-[hsl(var(--muted-fg))]">
                {scanStatusLabel}
              </span>
            )}
          </div>
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
            accept="image/*,application/pdf"
            aria-label="Upload scanned map"
            className="sr-only"
            onChange={handleFileChange}
          />
        </div>

        {/* Stat grid — acreage/sqft DERIVED from sections; turf/curb MANUAL
            blue-cell entry persisted on the estimate.
            BEAM SLOT: Beam AI automated takeoff (paused) will populate
            turfAreaAcres/curbMiles later — same fields, no UI change needed. */}
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          {derivedStats.map((stat) => (
            <div key={stat.label}>
              <p className="text-[11px] text-[hsl(var(--muted-fg))]">{stat.label}</p>
              <p className="mt-0.5 text-lg font-bold text-[hsl(var(--fg))]">{stat.value}</p>
            </div>
          ))}
          <div>
            <p className="text-[11px] text-[hsl(var(--muted-fg))]">Turf area</p>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              aria-label="Turf area (acres)"
              value={turfDraft}
              onChange={(e) => setTurfDraft(e.target.value)}
              onBlur={() => void commitMeta('turfAreaAcres', turfDraft, turfAreaAcres)}
              className={metaInputClass}
            />
          </div>
          <div>
            <p className="text-[11px] text-[hsl(var(--muted-fg))]">Curb miles</p>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              aria-label="Curb miles"
              value={curbDraft}
              onChange={(e) => setCurbDraft(e.target.value)}
              onBlur={() => void commitMeta('curbMiles', curbDraft, curbMiles)}
              className={metaInputClass}
            />
          </div>
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
