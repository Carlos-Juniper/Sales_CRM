// ---------------------------------------------------------------------------
// Opened from EstimateQueue's "Maintenance intake" CTA. Pipeline-sourced only
// (banner shows CRM lead context). Submitting creates a maintenance estimate
// (estimateType='maintenance' — immutable), persists the intake payload, starts
// the SLA clock, and routes to the Line-Item Editor which auto-renders the
// Maintenance engine (no mode prompt ever).
//
// BRD I-6.1: all required fields; I-6.2: SLA clock; I-6.3: CRM-sourced only;
// I-6.4: home-counting guidance; I-9.2: takeoff & scope intake.
//
// jsdom lacks hasPointerCapture, so customer type and contract structure use
// styled native <select> elements.
// ---------------------------------------------------------------------------

import { useEffect, useState, useRef, type ChangeEvent } from 'react'
import { Building2, FileText, Info, Paperclip, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { estimatingApi, estimatingConfigApi } from '@/api/estimating'
import { leadsApi } from '@/api/leads'
import {
  crmLeadFromLead,
  DEFAULT_WIN_PROBABILITY,
  type CrmLeadContext,
} from '@/lib/estimating/crmLead'
import type { Property } from '@/types/estimating'
import { SLA_CONFIG, toDateOnly } from '@/lib/estimating/sla'
import { DEFAULT_SERVICE_LINE } from '@/lib/estimating/aspireOptions'
import { PropertySelector } from './PropertySelector'
import { ServiceLineSelect } from './AspirePickers'
import { useEstimatingShell } from './useEstimatingShell'
import { useToast } from './useToast'
import type { BranchOption, Estimate, MaintenanceCustomerType } from '@/types/estimating'
import { FileAttachRow, type AttachedFile } from './IntakeFileAttachRow'
import { useAttachmentUpload } from '@/lib/estimating/useAttachmentUpload'
import { RFP_FILE_ACCEPT } from '@/lib/estimating/rfpContentTypes'

// ----- Types -----------------------------------------------------------------

// The CRM lead context type + mapper live in lib (react-refresh:
// component files export only components). Re-exported for existing importers.
export type { CrmLeadContext }

export interface MaintenanceIntakeModalProps {
  open: boolean
  onClose: () => void
  /**
   * REAL CRM lead context (the L-TBD stub is gone). Provided when
   * the caller already resolved the property's lead ("Request estimate" flow);
   * when absent the modal sources it from leads.property_id once a property is
   * selected.
   */
  crmLead?: CrmLeadContext | null
  /** Called after successful create so the queue can refresh. */
  onCreated: (estimate: Estimate) => void
  /**
   * "Request estimate" from the property/Accounts UI launches the
   * modal pre-filled with the canonical property. Null ⇒ intake starts blank.
   */
  initialProperty?: Property | null
}

type ContractStructure = 'single' | 'split'

interface FormState {
  // Lead & contact (I-6.1)
  contactName: string
  company: string
  phone: string
  email: string
  // Branch (required, populated from Aspire config). Holds the Aspire
  // BranchID (identity) as a string; the display city is resolved from
  // branchOptions on submit. Empty string ⇒ nothing selected.
  branch: string
  // Property
  customerType: MaintenanceCustomerType
  contractStructure: ContractStructure
  homesBudget: string
  commonAreaBudget: string
  /** Unit/home COUNT (I-6.4), distinct from budget dollars. */
  homeCount: string
  // Scope & dates
  scopeOfWork: string
  neededBack: string
  anticipatedClose: string
  serviceStart: string
  // Win probability (pre-filled from CRM, editable by salesperson)
  winProbabilityPct: string
}

// ----- Component -------------------------------------------------------------

export function MaintenanceIntakeModal({
  open,
  onClose,
  crmLead = null,
  onCreated,
  initialProperty = null,
}: MaintenanceIntakeModalProps) {
  const { openEstimateAt } = useEstimatingShell()
  const { show } = useToast()
  const { upload: uploadFile, lastUploadError } = useAttachmentUpload()

  const [form, setForm] = useState<FormState>(() => ({
    contactName: '',
    company: '',
    phone: '',
    email: '',
    branch: '',
    customerType: 'commercial',
    contractStructure: 'single',
    homesBudget: '',
    commonAreaBudget: '',
    homeCount: '',
    scopeOfWork: '',
    neededBack: '',
    anticipatedClose: '',
    serviceStart: '',
    winProbabilityPct: String(
      Math.round((crmLead?.winProbability ?? DEFAULT_WIN_PROBABILITY) * 100),
    ),
  }))

  const [propertyMapFile, setPropertyMapFile] = useState<AttachedFile | null>(null)
  const [rfpFile, setRfpFile] = useState<AttachedFile | null>(null)
  const [otherFiles, setOtherFiles] = useState<AttachedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  // Aspire opportunity linkage: the property (→ PropertyID) and the service line
  // (→ DivisionID). Optional at intake; the backend defaults/pends what's missing.
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(initialProperty)
  const [serviceLine, setServiceLine] = useState<string>(DEFAULT_SERVICE_LINE.maintenance)
  // Aspire-derived maintenance branch options.
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([])
  // Resolved city for the top-of-form branch selection — passed through to
  // PropertySelector so a newly created property reuses it instead of asking again.
  const selectedBranchCity =
    branchOptions.find((b) => String(b.aspire_branch_id) === form.branch)?.city ?? null

  // Adopt an incoming property ("Request estimate" pre-fill) when
  // the modal (re)opens with one. Render-phase derived-state pattern — no effect.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open && initialProperty) setSelectedProperty(initialProperty)
  }

  // REAL lead context. When the caller didn't resolve it, source
  // it from the selected property via leads.property_id (there is always a lead
  // on the "Request estimate" path — the action is gated on it, §1a).
  const [fetchedLead, setFetchedLead] = useState<CrmLeadContext | null>(null)
  const selectedPropertyId = selectedProperty?.id ?? null
  useEffect(() => {
    if (!open || crmLead || !selectedPropertyId) return
    let cancelled = false
    leadsApi
      .list({ property_id: selectedPropertyId, page_size: 100 })
      .then((res) => {
        if (cancelled) return
        const active =
          res.data.find((l) => l.status !== 'won' && l.status !== 'lost') ?? res.data[0]
        setFetchedLead(active ? crmLeadFromLead(active) : null)
      })
      .catch(() => {
        /* best-effort — banner simply shows no lead */
      })
    return () => {
      cancelled = true
    }
  }, [open, crmLead, selectedPropertyId])

  const leadCtx = crmLead ?? fetchedLead

  // When a lead context arrives (or changes), pre-fill win probability and
  // contact fields — still editable by the salesperson afterwards.
  const [appliedLeadNumber, setAppliedLeadNumber] = useState<string | null>(
    crmLead?.leadNumber ?? null,
  )
  if (leadCtx && leadCtx.leadNumber !== appliedLeadNumber) {
    setAppliedLeadNumber(leadCtx.leadNumber)
    setForm((prev) => ({
      ...prev,
      winProbabilityPct: String(Math.round(leadCtx.winProbability * 100)),
      // WS1: pre-fill contact fields from the lead if the form fields are still blank.
      contactName: prev.contactName || leadCtx.contactName || prev.contactName,
      email: prev.email || leadCtx.contactEmail || prev.email,
    }))
  }

  // Fetch Aspire-derived maintenance branch options once on open.
  useEffect(() => {
    if (!open) return
    estimatingConfigApi
      .branches('maintenance')
      .then(setBranchOptions)
      .catch(() => {
        show('Could not load branch list — please close and reopen the form.')
      })
  }, [open])

  const propertyMapRef = useRef<HTMLInputElement>(null)
  const rfpRef = useRef<HTMLInputElement>(null)
  const otherRef = useRef<HTMLInputElement>(null)

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handlePropertyMapChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setPropertyMapFile({ file, name: file.name })
    e.target.value = ''
  }

  function handleRfpChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setRfpFile({ file, name: file.name })
    e.target.value = ''
  }

  function handleOtherChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files) {
      const added = Array.from(files).map((f) => ({ file: f, name: f.name }))
      setOtherFiles((prev) => [...prev, ...added])
    }
    e.target.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.branch) {
      show('Select a branch before submitting.')
      return
    }
    if (!selectedProperty) {
      show('Select or create a property before submitting.')
      return
    }
    setSubmitting(true)

    try {
      // SLA clock: dueBackDate from the "needed back" field, or +14 days from now.
      // due_back_date is a SQL DATE column — must stay 'YYYY-MM-DD', not a full timestamp.
      const dueBackDate = form.neededBack
        ? toDateOnly(form.neededBack)
        : toDateOnly(new Date(Date.now() + SLA_CONFIG.returnWindowDays * 86400000))

      const winProbability = Math.min(1.0, Math.max(0.2, Number(form.winProbabilityPct) / 100))

      // Branch identity rides on the Aspire BranchID (int); the city label is
      // resolved from the loaded options for the display column.
      const aspireBranchId = Number(form.branch)
      const branchCity = selectedBranchCity

      // Build intake payload persisted verbatim (I-6.1; parsing uploads is
      // explicitly future scope — files stored for estimator to open).
      const intakePayload: Record<string, unknown> = {
        crmLeadNumber: leadCtx?.leadNumber ?? null,
        crmRep: leadCtx?.rep ?? null,
        contactName: form.contactName,
        company: form.company,
        phone: form.phone,
        email: form.email,
        customerType: form.customerType,
        contractStructure: form.contractStructure,
        ...(form.contractStructure === 'split' && {
          homesBudget: form.homesBudget,
          commonAreaBudget: form.commonAreaBudget,
        }),
        // Unit/home COUNT (I-6.4: count only units in the
        // proposed scope). Distinct from the budget dollars above.
        homeCount: form.homeCount || null,
        scopeOfWork: form.scopeOfWork,
        neededBack: form.neededBack || null,
        anticipatedClose: form.anticipatedClose || null,
        serviceStart: form.serviceStart || null,
        attachments: {
          propertyMap: propertyMapFile?.name ?? null,
          rfp: rfpFile?.name ?? null,
          other: otherFiles.map((f) => f.name),
        },
      }
      const created = await estimatingApi.create({
        estimateType: 'maintenance',
        name: form.company || form.contactName || 'Maintenance Intake',
        aspireNumber: null,
        // Property link + service line drive the Aspire opportunity push.
        propertyId: selectedProperty?.id ?? null,
        // Pipeline-sourced only (I-6.3) — the linked lead is already resolved via
        // leadCtx (crmLead prop or fetched from the selected property), never a
        // free-text override. Moves the lead Qualifying→Estimating on create.
        leadId: leadCtx?.leadNumber || null,
        serviceLine,
        clientName: form.company || selectedProperty?.name || form.contactName,
        aspireBranchId,
        branchCity,
        customerType: form.customerType,
        acreage: null,
        contractValueCents: 0,
        targetMargin: 0.22,
        status: 'new_from_sales',
        lifecycle: 'bidding',
        aspireOwner: 'estimating',
        priority: 'medium',
        winProbability,
        siteWalkDate: null,
        dueBackDate,
        anticipatedCloseDate: form.anticipatedClose ? toDateOnly(form.anticipatedClose) : null,
        serviceStartDate: form.serviceStart ? toDateOnly(form.serviceStart) : null,
        assignedLsEstimator: null,
        assignedIrrEstimator: null,
        crmRep: leadCtx?.rep ?? null,
        // Structured intake goes to its own table (intake_submissions), never notes.
        intake: { payload: intakePayload },
        sections: [],
      })

      // Upload each file directly to GCS — presign → XHR PUT → confirm per file.
      // One hook, so uploads run one at a time and each failure's API `detail`
      // (or the client-side rejection) is available on lastUploadError.
      // Errors are non-fatal: the estimate already exists; the toast shows the
      // detail and the estimator can resubmit files outside the modal.
      const uploads: Array<() => Promise<unknown>> = [
        ...(propertyMapFile ? [() => uploadFile(created.id, propertyMapFile.file, 'property_map')] : []),
        ...(rfpFile ? [() => uploadFile(created.id, rfpFile.file, 'rfp')] : []),
        ...otherFiles.map((f) => () => uploadFile(created.id, f.file, 'other')),
      ]
      const uploadErrors: string[] = []
      for (const start of uploads) {
        const attachment = await start()
        const uploadError = lastUploadError()
        if (!attachment && uploadError) uploadErrors.push(uploadError)
      }

      show(
        uploadErrors.length > 0
          ? uploadErrors.join(' ')
          : 'Maintenance estimate created — opening editor…',
      )
      onCreated(created)
      openEstimateAt(created, 'editor')
      onClose()
    } catch {
      show('Failed to create estimate — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Format win probability for the banner display
  const winPct = leadCtx ? Math.round(leadCtx.winProbability * 100) : null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#2E7D52]" />
            Maintenance Intake
          </DialogTitle>
          <DialogDescription>
            Capture site details and attachments for this maintenance opportunity before creating the estimate.
          </DialogDescription>
        </DialogHeader>

        {/* CRM pipeline banner (I-6.3 — pipeline-sourced only) */}
        <div className="rounded-md bg-[#e8f3ed] border border-[#bfdcc9] px-3 py-2 text-xs text-[#2E7D52] flex items-center gap-2">
          <Info className="h-3.5 w-3.5 flex-shrink-0" />
          {leadCtx ? (
            <span>
              Sourced from CRM pipeline — lead{' '}
              <strong>#{leadCtx.leadNumber}</strong>, {leadCtx.rep} · win probability{' '}
              <strong>{winPct}%</strong>
            </span>
          ) : (
            <span>Sourced from CRM pipeline — select a property to link its lead</span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Lead & Contact (I-6.1) ─────────────────────────── */}
          <section>
            <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
              Lead &amp; Contact
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="mi-contact-name" className="text-xs">
                  Contact name *
                </Label>
                <Input
                  id="mi-contact-name"
                  value={form.contactName}
                  onChange={(e) => set('contactName', e.target.value)}
                  placeholder="Jane Smith"
                  required
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mi-company" className="text-xs">
                  Company *
                </Label>
                <Input
                  id="mi-company"
                  value={form.company}
                  onChange={(e) => set('company', e.target.value)}
                  placeholder="Dobson Ranch HOA"
                  required
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mi-phone" className="text-xs">
                  Phone *
                </Label>
                <Input
                  id="mi-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="602-555-1234"
                  required
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mi-email" className="text-xs">
                  Email *
                </Label>
                <Input
                  id="mi-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  placeholder="jane@example.com"
                  required
                  className="h-8 text-xs"
                />
              </div>
              {/* Branch — populated from Aspire config endpoint */}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="mi-branch" className="text-xs">
                  Branch *
                </Label>
                <select
                  id="mi-branch"
                  value={form.branch}
                  onChange={(e) => set('branch', e.target.value)}
                  className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]"
                >
                  <option value="">— select branch —</option>
                  {branchOptions.map((b) => (
                    <option key={b.aspire_branch_id} value={String(b.aspire_branch_id)}>{b.city}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* ── Aspire linkage: property + service line ─────────── */}
          <section>
            <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
              Aspire property &amp; service line
            </p>
            <div className="space-y-3">
              <PropertySelector
                value={selectedProperty}
                onSelect={setSelectedProperty}
                branchCity={selectedBranchCity}
              />
              <ServiceLineSelect label="Service line" value={serviceLine} onChange={setServiceLine} />
            </div>
          </section>

          {/* ── Property (I-6.1) ───────────────────────────────── */}
          <section>
            <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
              Property
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Customer type — native <select> (jsdom hasPointerCapture workaround) */}
                <div className="space-y-1">
                  <Label htmlFor="mi-customer-type" className="text-xs">
                    Customer type *
                  </Label>
                  <select
                    id="mi-customer-type"
                    value={form.customerType}
                    onChange={(e) => set('customerType', e.target.value as MaintenanceCustomerType)}
                    required
                    className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]"
                  >
                    <option value="commercial">Commercial</option>
                    <option value="cdd">CDD</option>
                    <option value="hoa">HOA</option>
                    <option value="government">Government</option>
                  </select>
                </div>
                {/* Contract structure — native <select> */}
                <div className="space-y-1">
                  <Label htmlFor="mi-contract-structure" className="text-xs">
                    Contract structure *
                  </Label>
                  <select
                    id="mi-contract-structure"
                    value={form.contractStructure}
                    onChange={(e) => set('contractStructure', e.target.value as ContractStructure)}
                    required
                    className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]"
                  >
                    <option value="single">Single</option>
                    <option value="split">Split (homes + common areas)</option>
                  </select>
                </div>
              </div>

              {/* Split budgets (I-6.4 — homes vs. common areas) */}
              {form.contractStructure === 'split' && (
                <div className="grid grid-cols-2 gap-3 pl-0 border-l-2 border-[#bfdcc9] pl-3">
                  <div className="space-y-1">
                    <Label htmlFor="mi-homes-budget" className="text-xs">
                      Homes budget ($) *
                    </Label>
                    <Input
                      id="mi-homes-budget"
                      type="number"
                      min={0}
                      value={form.homesBudget}
                      onChange={(e) => set('homesBudget', e.target.value)}
                      placeholder="120000"
                      required
                      className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="mi-common-area-budget" className="text-xs">
                      Common area budget ($) *
                    </Label>
                    <Input
                      id="mi-common-area-budget"
                      type="number"
                      min={0}
                      value={form.commonAreaBudget}
                      onChange={(e) => set('commonAreaBudget', e.target.value)}
                      placeholder="80000"
                      required
                      className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]"
                    />
                  </div>
                </div>
              )}

              {/* Unit/home COUNT, distinct from the budget
                  dollars above. Carries the I-6.4 counting guidance. */}
              <div className="space-y-1 max-w-[220px]">
                <Label htmlFor="mi-home-count" className="text-xs">
                  Home / unit count
                </Label>
                <Input
                  id="mi-home-count"
                  type="number"
                  min={0}
                  step={1}
                  value={form.homeCount}
                  onChange={(e) => set('homeCount', e.target.value)}
                  placeholder="142"
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-[hsl(var(--muted-fg))]">
                  Count only units in the proposed scope (I-6.4)
                </p>
              </div>
            </div>
          </section>

          {/* ── Scope & Dates (I-6.1 / I-9.2) ────────────────── */}
          <section>
            <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
              Scope &amp; Dates
            </p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="mi-scope" className="text-xs">
                  Scope of work *
                </Label>
                <Textarea
                  id="mi-scope"
                  value={form.scopeOfWork}
                  onChange={(e) => set('scopeOfWork', e.target.value)}
                  placeholder="Full grounds maintenance including mowing, irrigation, seasonal color…"
                  required
                  rows={3}
                  className="text-xs"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="mi-needed-back" className="text-xs">
                    Needed back
                  </Label>
                  <Input
                    id="mi-needed-back"
                    type="date"
                    value={form.neededBack}
                    onChange={(e) => set('neededBack', e.target.value)}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-[hsl(var(--muted-fg))]">
                    Defaults to +14 days from today if blank (SLA minimum)
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mi-anticipated-close" className="text-xs">
                    Anticipated close
                  </Label>
                  <Input
                    id="mi-anticipated-close"
                    type="date"
                    value={form.anticipatedClose}
                    onChange={(e) => set('anticipatedClose', e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mi-service-start" className="text-xs">
                    Service start
                  </Label>
                  <Input
                    id="mi-service-start"
                    type="date"
                    value={form.serviceStart}
                    onChange={(e) => set('serviceStart', e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── Win Probability (I-6.1) ────────────────────────── */}
          <section>
            <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
              Win Probability
            </p>
            <div className="space-y-1 max-w-[200px]">
              <Label htmlFor="mi-win-probability" className="text-xs">
                Win probability (%) *
              </Label>
              <Input
                id="mi-win-probability"
                type="number"
                min={20}
                max={100}
                step={5}
                value={form.winProbabilityPct}
                onChange={(e) => set('winProbabilityPct', e.target.value)}
                required
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-[hsl(var(--muted-fg))]">20–100% (set by salesperson)</p>
            </div>
          </section>

          {/* ── Takeoff Files (I-6.1 / I-9.2) ────────────────── */}
          <section>
            <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
              Takeoff Files
            </p>
            <p className="text-[10px] text-[hsl(var(--muted-fg))] mb-3">
              Files are stored for the estimator to open — auto-population from uploads is future scope.
            </p>
            <div className="space-y-3">
              {/* Property map */}
              <FileAttachRow
                label="Property map"
                hint="PDF — must clearly delineate common areas for common-area-only scope"
                file={propertyMapFile}
                testId="property-map-file-area"
                inputRef={propertyMapRef}
                accept="application/pdf"
                onChange={handlePropertyMapChange}
                onClear={() => setPropertyMapFile(null)}
              />

              {/* RFP document */}
              <FileAttachRow
                label="RFP document"
                hint="PDF, Word (.doc, .docx), or Excel (.xls, .xlsx)"
                file={rfpFile}
                testId="rfp-file-area"
                inputRef={rfpRef}
                accept={RFP_FILE_ACCEPT}
                actionLabel="Attach file"
                onChange={handleRfpChange}
                onClear={() => setRfpFile(null)}
              />

              {/* Other files */}
              <div>
                <p className="text-xs font-medium mb-1">Attach other files</p>
                <p className="text-[10px] text-[hsl(var(--muted-fg))] mb-2">
                  Incumbent contract, spec sheets, reference docs
                </p>
                <input
                  ref={otherRef}
                  type="file"
                  multiple
                  className="sr-only"
                  aria-label="Attach other files"
                  onChange={handleOtherChange}
                />
                <button
                  type="button"
                  onClick={() => otherRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-dashed border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-fg))] hover:border-[#2E7D52] hover:text-[#2E7D52] transition-colors cursor-pointer"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach files
                </button>
                {otherFiles.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {otherFiles.map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-xs text-[hsl(var(--fg))]">
                        <FileText className="h-3 w-3 flex-shrink-0" />
                        {f.name}
                        <button
                          type="button"
                          onClick={() => setOtherFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="ml-auto p-0.5 rounded hover:bg-[hsl(var(--muted))] cursor-pointer"
                          aria-label={`Remove ${f.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {/* ── SLA note (I-6.2) ──────────────────────────────── */}
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 flex items-start gap-2">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>14-calendar-day minimum return window applies</strong> — SLA clock starts on
              create. The "Needed back" date must be at least {SLA_CONFIG.returnWindowDays} calendar
              days from today.
            </span>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="bg-[#2E7D52] hover:bg-[#256844] text-white"
            >
              {submitting ? 'Submitting…' : 'Submit intake'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

