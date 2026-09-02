// ---------------------------------------------------------------------------
// Install Proposal Request Modal
//
// Opened from EstimateQueue's "Install intake" CTA. This is a fully editable,
// Sales-authored form — unlike the maintenance intake it is NOT pipeline-sourced.
// Banner: "Sales-authored · submits to the estimating queue (BRD II-9.1)."
//
// Submitting creates an install estimate with:
//   estimateType = 'install' (immutable)
//   status       = 'new_from_sales'
//   dueBackDate  = SLA clock start (default +14 days)
//
// BRD II-6.1: proposal request form; II-6.2: RFI rule; II-9.1: bid intake.
// Reference: New Install Proposal Request Form.xlsx.
//
// jsdom lacks hasPointerCapture — all dropdowns use styled native <select>
// (same pattern as elsewhere in the estimating intake forms).
// ---------------------------------------------------------------------------

import { useEffect, useState, useRef, type ChangeEvent } from 'react'
import { Building2, Info } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { estimatingApi, estimatingConfigApi } from '@/api/estimating'
import type { Property } from '@/types/estimating'
import { DEFAULT_SERVICE_LINE } from '@/lib/estimating/aspireOptions'
import { SLA_CONFIG, toDateOnly } from '@/lib/estimating/sla'
import { useEstimatingShell } from './useEstimatingShell'
import { useToast } from './useToast'
import type { InstallCustomerType } from '@/types/estimating'
import type { Estimate } from '@/types/estimating'
import type { AttachedFile } from './IntakeFileAttachRow'
import { useAttachmentUpload } from '@/lib/estimating/useAttachmentUpload'
import {
  type FormState,
  type BranchOption,
  AspireSection,
  RequestorSection,
  DatesProbabilitySection,
  OpportunitySection,
  PropertySection,
  ClientSection,
  LandscapeScopeSection,
  IrrigationScopeSection,
  RfiSection,
  TakeoffFilesSection,
} from './InstallIntakeSections'
// ----- Types -----------------------------------------------------------------

export interface InstallIntakeModalProps {
  open: boolean
  onClose: () => void
  /** Called after successful create so the queue can refresh. */
  onCreated: (estimate: Estimate) => void
  /**
   * "Request estimate" from the property/Accounts UI launches the
   * modal pre-filled with the canonical property. Null ⇒ intake starts blank.
   */
  initialProperty?: Property | null
}

// ----- Component -------------------------------------------------------------

export function InstallIntakeModal({ open, onClose, onCreated, initialProperty = null }: InstallIntakeModalProps) {
  const { openEstimateAt } = useEstimatingShell()
  const { show } = useToast()
  const { upload: uploadFile } = useAttachmentUpload()

  const today = new Date().toISOString().split('T')[0]

  const defaultForm = (): FormState => ({
    leadId: '',
    requestedBy: '',
    installBranch: '',
    phone: '',
    email: '',
    requestDate: today,
    isNewClient: false,
    isBondRequired: false,
    isDuplicate: false,

    internalDeadline: '',
    clientDeadline: '',
    startDate: '',
    anticipatedClose: '',
    winProbabilityPct: '50',

    opportunityName: '',
    estimatedValue: '',
    industry: 'commercial',
    serviceTypes: {
      landscapeInstall: false,
      irrigation: false,
      hardscape: false,
      gradingDrainage: false,
      lighting: false,
    },

    propertyName: '',
    acreage: '',
    address: '',
    city: '',
    county: '',
    state: '',
    zip: '',

    company: '',
    contactPerson: '',
    clientEmail: '',
    clientPhone: '',
    clientAddress: '',

    plantingBedsSf: '',
    treesCount: '',
    shrubsGroundcoverCount: '',
    sodTurfSf: '',
    mulchDgCy: '',
    hardscapeSf: '',
    hardscapeType: '',
    gradingCutFillCy: '',
    soilAmendment: '',
    landscapeNotes: '',

    landscapePlanProvided: false,
    planTypeCodeMin: false,
    veOptions: false,
    bidFormRequired: false,
    bidBySchedule: false,
    oneYrMaintenanceAgreement: false,
    vendorQuotesRequired: false,
    subcontractorQuotesRequired: false,

    irrZones: '',
    controllerType: '',
    waterSource: '',
    backflowDevice: '',
    mainlineSizeIn: '',
    staticPressurePsi: '',
    meterSizeIn: '',
    headType: '',
    rainFlowSensor: '',
    irrNotes: '',

    irrPlanProvided: false,
    waterUsePermit: false,
    designRequired: false,
    bidScheduleExists: false,
    pumpStationRequired: false,
    pumpStationDesignProvided: false,
    fullCoverage: false,
    separation: false,
    supplementalWell: false,

    irrMaterialTrees: false,
    irrMaterialShrubs: false,
    irrMaterialSod: false,

    rfiStatus: '',
  })

  const [form, setForm] = useState<FormState>(defaultForm)
  // Backend Save-draft. The id of the server draft this form
  // is bound to (created on first save / adopted on resume); null ⇒ none yet.
  const [draftId, setDraftId] = useState<string | null>(null)
  // Aspire-derived install branch options.
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([])

  // Resume the latest saved draft from the BACKEND when the modal opens —
  // drafts are per-user and device-independent (they replaced localStorage).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    estimatingApi
      .listIntakeDrafts('install')
      .then((drafts) => {
        const latest = drafts[0]
        if (cancelled || !latest) return
        setForm({ ...defaultForm(), ...(latest.payload as Partial<FormState>) })
        setDraftId(latest.id)
      })
      .catch(() => {
        // Draft resume is best-effort — a fresh form is always a safe fallback.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Fetch Aspire-derived install branch options once on open.
  useEffect(() => {
    if (!open) return
    estimatingConfigApi
      .branches('install')
      .then(setBranchOptions)
      .catch(() => {
        show('Could not load branch list — please close and reopen the form.')
      })
  }, [open])

  const [propertyMapFile, setPropertyMapFile] = useState<AttachedFile | null>(null)
  const [rfpFile, setRfpFile] = useState<AttachedFile | null>(null)
  const [otherFiles, setOtherFiles] = useState<AttachedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  // Aspire opportunity linkage: property (→ PropertyID) + service line (→ DivisionID).
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(initialProperty)
  const [serviceLine, setServiceLine] = useState<string>(DEFAULT_SERVICE_LINE.install)

  // Adopt an incoming property ("Request estimate" pre-fill) when
  // the modal (re)opens with one. Render-phase derived-state pattern — no effect.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open && initialProperty) setSelectedProperty(initialProperty)
  }

  const propertyMapRef = useRef<HTMLInputElement>(null)
  const rfpRef = useRef<HTMLInputElement>(null)
  const otherRef = useRef<HTMLInputElement>(null)

  function setStr(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function setBool(field: keyof FormState, value: boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function setServiceType(key: keyof FormState['serviceTypes'], value: boolean) {
    setForm((prev) => ({
      ...prev,
      serviceTypes: { ...prev.serviceTypes, [key]: value },
    }))
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

  function buildIntakePayload(branchCity: string | null) {
    return {
      leadId: form.leadId || null,
      requestedBy: form.requestedBy,
      // Persist the human-readable city (identity travels on the estimate's
      // aspireBranchId); form.installBranch now holds the raw Aspire id string.
      installBranch: branchCity ?? form.installBranch,
      phone: form.phone,
      email: form.email,
      requestDate: form.requestDate,
      isNewClient: form.isNewClient,
      isBondRequired: form.isBondRequired,
      isDuplicate: form.isDuplicate,
      internalDeadline: form.internalDeadline || null,
      clientDeadline: form.clientDeadline || null,
      startDate: form.startDate || null,
      anticipatedClose: form.anticipatedClose || null,
      winProbabilityPct: form.winProbabilityPct,
      opportunityName: form.opportunityName,
      estimatedValue: form.estimatedValue || null,
      industry: form.industry,
      serviceTypes: form.serviceTypes,
      propertyName: form.propertyName,
      acreage: form.acreage || null,
      address: form.address,
      city: form.city,
      county: form.county || null,
      state: form.state,
      zip: form.zip,
      company: form.company,
      contactPerson: form.contactPerson,
      clientEmail: form.clientEmail || null,
      clientPhone: form.clientPhone || null,
      clientAddress: form.clientAddress || null,
      landscapeScope: {
        plantingBedsSf: form.plantingBedsSf || null,
        treesCount: form.treesCount || null,
        shrubsGroundcoverCount: form.shrubsGroundcoverCount || null,
        sodTurfSf: form.sodTurfSf || null,
        mulchDgCy: form.mulchDgCy || null,
        hardscapeSf: form.hardscapeSf || null,
        hardscapeType: form.hardscapeType || null,
        gradingCutFillCy: form.gradingCutFillCy || null,
        soilAmendment: form.soilAmendment || null,
        landscapePlanProvided: form.landscapePlanProvided,
        planTypeCodeMin: form.planTypeCodeMin,
        veOptions: form.veOptions,
        bidFormRequired: form.bidFormRequired,
        bidBySchedule: form.bidBySchedule,
        oneYrMaintenanceAgreement: form.oneYrMaintenanceAgreement,
        vendorQuotesRequired: form.vendorQuotesRequired,
        subcontractorQuotesRequired: form.subcontractorQuotesRequired,
        notes: form.landscapeNotes || null,
      },
      irrigationScope: {
        zones: form.irrZones || null,
        controllerType: form.controllerType || null,
        waterSource: form.waterSource || null,
        backflowDevice: form.backflowDevice || null,
        mainlineSizeIn: form.mainlineSizeIn || null,
        staticPressurePsi: form.staticPressurePsi || null,
        meterSizeIn: form.meterSizeIn || null,
        headType: form.headType || null,
        rainFlowSensor: form.rainFlowSensor || null,
        irrPlanProvided: form.irrPlanProvided,
        waterUsePermit: form.waterUsePermit,
        designRequired: form.designRequired,
        bidScheduleExists: form.bidScheduleExists,
        pumpStationRequired: form.pumpStationRequired,
        pumpStationDesignProvided: form.pumpStationDesignProvided,
        fullCoverage: form.fullCoverage,
        separation: form.separation,
        supplementalWell: form.supplementalWell,
        materialToIrrigate: {
          trees: form.irrMaterialTrees,
          shrubs: form.irrMaterialShrubs,
          sod: form.irrMaterialSod,
        },
        notes: form.irrNotes || null,
      },
      rfiStatus: form.rfiStatus || null,
      attachments: {
        propertyMap: propertyMapFile?.name ?? null,
        rfp: rfpFile?.name ?? null,
        other: otherFiles.map((f) => f.name),
      },
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.installBranch) {
      show('Select a branch before submitting.')
      return
    }
    setSubmitting(true)

    try {
      // due_back_date is a SQL DATE column — must stay 'YYYY-MM-DD', not a full timestamp.
      const dueBackDate = form.internalDeadline
        ? toDateOnly(form.internalDeadline)
        : toDateOnly(new Date(Date.now() + SLA_CONFIG.returnWindowDays * 86400000))

      const winProbability = Math.min(1.0, Math.max(0.2, Number(form.winProbabilityPct) / 100))

      // Branch identity rides on the Aspire BranchID (int); the city label is
      // resolved from the loaded options for the display column.
      const aspireBranchId = Number(form.installBranch)
      const branchCity = branchOptions.find((b) => b.aspire_branch_id === aspireBranchId)?.city ?? null

      const intakePayload = buildIntakePayload(branchCity)
      const created = await estimatingApi.create({
        estimateType: 'install',
        name: form.opportunityName || form.propertyName || 'Install Intake',
        aspireNumber: null,
        // Property link + service line drive the Aspire opportunity push.
        propertyId: selectedProperty?.id ?? null,
        // Pipeline kanban redesign — moves the linked lead Qualifying→Estimating.
        leadId: form.leadId || null,
        serviceLine,
        clientName: form.company || form.contactPerson,
        aspireBranchId,
        branchCity,
        customerType: form.industry as InstallCustomerType,
        acreage: form.acreage ? parseFloat(form.acreage) : null,
        contractValueCents: form.estimatedValue ? Math.round(parseFloat(form.estimatedValue) * 100) : 0,
        targetMargin: 0.22,
        status: 'new_from_sales',
        lifecycle: 'bidding',
        aspireOwner: 'estimating',
        priority: 'medium',
        winProbability,
        siteWalkDate: null,
        dueBackDate,
        anticipatedCloseDate: form.anticipatedClose ? toDateOnly(form.anticipatedClose) : null,
        serviceStartDate: form.startDate ? toDateOnly(form.startDate) : null,
        assignedLsEstimator: null,
        assignedIrrEstimator: null,
        crmRep: form.requestedBy || null,
        // RFI status is tracked first-class on the estimate
        // row (surfaced in queue/editor), in addition to the verbatim payload.
        rfiStatus: form.rfiStatus || null,
        // Structured intake goes to its own table (never notes); leave notes for a
        // short human queue note if one is ever added to this form.
        intake: { payload: intakePayload },
        sections: [],
      })

      // Upload each file directly to GCS — presign → XHR PUT → confirm per file.
      const uploads: Array<() => Promise<unknown>> = [
        ...(propertyMapFile ? [() => uploadFile(created.id, propertyMapFile.file, 'property_map')] : []),
        ...(rfpFile ? [() => uploadFile(created.id, rfpFile.file, 'rfp')] : []),
        ...otherFiles.map((f) => () => uploadFile(created.id, f.file, 'other')),
      ]
      await Promise.allSettled(uploads.map((fn) => fn()))

      // Submitted successfully — discard the server-side draft (best-effort).
      if (draftId) {
        estimatingApi.deleteIntakeDraft(draftId).catch(() => {})
        setDraftId(null)
      }
      show('Install request sent to Estimating.')
      onCreated(created)
      openEstimateAt(created, 'editor')
      onClose()
    } catch {
      show('Failed to create estimate — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveDraft() {
    // Persist serializable form fields to the backend so the
    // rep can resume on any device. Saves NO estimate and fires NO Aspire push.
    // (Attachments are File objects and can't ride along; they re-attach on
    // resume, same as the old localStorage path.)
    try {
      const saved = await estimatingApi.saveIntakeDraft({
        estimateType: 'install',
        payload: { ...form },
        ...(draftId ? { draftId } : {}),
      })
      setDraftId(saved.id)
      show('Draft saved.')
    } catch {
      show('Could not save draft — please try again.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#2E7D52]" />
            Install Proposal Request
          </DialogTitle>
          <DialogDescription>
            Provide project scope and attachments for this install proposal before creating the estimate.
          </DialogDescription>
        </DialogHeader>

        {/* Sales-authored banner (BRD II-9.1) */}
        <div className="rounded-md bg-[#e8f3ed] border border-[#bfdcc9] px-3 py-2 text-xs text-[#2E7D52] flex items-center gap-2">
          <Info className="h-3.5 w-3.5 flex-shrink-0" />
          <span>
            <strong>Sales-authored</strong> · submits to the estimating queue (BRD II-9.1)
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <AspireSection
            selectedProperty={selectedProperty}
            onSelectProperty={setSelectedProperty}
            serviceLine={serviceLine}
            onChangeServiceLine={setServiceLine}
          />

          <RequestorSection form={form} setStr={setStr} setBool={setBool} branchOptions={branchOptions} />

          <DatesProbabilitySection form={form} setStr={setStr} />

          <OpportunitySection form={form} setStr={setStr} setServiceType={setServiceType} />

          <PropertySection form={form} setStr={setStr} />

          <ClientSection form={form} setStr={setStr} />

          <LandscapeScopeSection form={form} setStr={setStr} setBool={setBool} />

          <IrrigationScopeSection form={form} setStr={setStr} setBool={setBool} />

          <RfiSection form={form} setStr={setStr} />

          <TakeoffFilesSection
            propertyMapFile={propertyMapFile}
            rfpFile={rfpFile}
            otherFiles={otherFiles}
            propertyMapRef={propertyMapRef}
            rfpRef={rfpRef}
            otherRef={otherRef}
            onPropertyMapChange={handlePropertyMapChange}
            onRfpChange={handleRfpChange}
            onOtherChange={handleOtherChange}
            onClearPropertyMap={() => setPropertyMapFile(null)}
            onClearRfp={() => setRfpFile(null)}
            onRemoveOther={(i) => setOtherFiles((prev) => prev.filter((_, j) => j !== i))}
          />

          <DialogFooter className="flex items-center gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              disabled={submitting}
            >
              Save draft
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="bg-[#2E7D52] hover:bg-[#256844] text-white"
            >
              {submitting ? 'Submitting…' : 'Send to Estimating'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
