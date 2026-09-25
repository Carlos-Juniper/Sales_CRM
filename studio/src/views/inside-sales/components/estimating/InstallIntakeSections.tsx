// ---------------------------------------------------------------------------
// InstallIntakeSections — presentational subcomponents for each <section>
// of the Install Proposal Request form. All markup, IDs, aria-labels, and
// visible text are identical to what was inline in InstallIntakeModal.tsx.
//
// State ownership stays in the modal — each section receives the pieces of
// FormState it needs plus the setStr / setBool / setServiceType setters.
// ---------------------------------------------------------------------------

import type { ChangeEvent, RefObject } from 'react'
import { FileText, Info, Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PropertySelector } from './PropertySelector'
import { ServiceLineSelect } from './AspirePickers'
import { SLA_CONFIG } from '@/lib/estimating/sla'
import { FileAttachRow } from './IntakeFileAttachRow'
import { RFP_FILE_ACCEPT } from '@/lib/estimating/rfpContentTypes'
import type { AttachedFile } from './IntakeFileAttachRow'
import type { BranchOption, InstallCustomerType, Property } from '@/types/estimating'

export type { BranchOption }

// Re-export the flat FormState so InstallIntakeModal can import from here or
// keep it local — we define it here and re-export to keep the modal slimmer.
export interface FormState {
  // Requestor
  leadId: string
  requestedBy: string
  installBranch: string
  phone: string
  email: string
  requestDate: string
  isNewClient: boolean
  isBondRequired: boolean
  isDuplicate: boolean

  // Dates & probability
  internalDeadline: string
  clientDeadline: string
  startDate: string
  anticipatedClose: string
  winProbabilityPct: string

  // Opportunity
  opportunityName: string
  estimatedValue: string
  industry: InstallCustomerType
  serviceTypes: {
    landscapeInstall: boolean
    irrigation: boolean
    hardscape: boolean
    gradingDrainage: boolean
    lighting: boolean
  }

  // Client
  company: string
  contactPerson: string
  clientEmail: string
  clientPhone: string
  clientAddress: string

  // Landscape scope
  plantingBedsSf: string
  treesCount: string
  shrubsGroundcoverCount: string
  sodTurfSf: string
  mulchDgCy: string
  hardscapeSf: string
  hardscapeType: string
  gradingCutFillCy: string
  soilAmendment: string
  landscapeNotes: string

  // Landscape Yes/No toggles
  landscapePlanProvided: boolean
  planTypeCodeMin: boolean
  veOptions: boolean
  bidFormRequired: boolean
  bidBySchedule: boolean
  oneYrMaintenanceAgreement: boolean
  vendorQuotesRequired: boolean
  subcontractorQuotesRequired: boolean

  // Irrigation scope
  irrZones: string
  controllerType: string
  waterSource: string
  backflowDevice: string
  mainlineSizeIn: string
  staticPressurePsi: string
  meterSizeIn: string
  headType: string
  rainFlowSensor: string
  irrNotes: string

  // Irrigation Yes/No toggles
  irrPlanProvided: boolean
  waterUsePermit: boolean
  designRequired: boolean
  bidScheduleExists: boolean
  pumpStationRequired: boolean
  pumpStationDesignProvided: boolean
  fullCoverage: boolean
  separation: boolean
  supplementalWell: boolean

  // Irrigation material
  irrMaterialTrees: boolean
  irrMaterialShrubs: boolean
  irrMaterialSod: boolean

  // RFI status (first-class field per II-6.2)
  rfiStatus: string
}

// Shared setter types passed down from the modal.
type SetStr = (field: keyof FormState, value: string) => void
type SetBool = (field: keyof FormState, value: boolean) => void
type SetServiceType = (key: keyof FormState['serviceTypes'], value: boolean) => void

// ---------------------------------------------------------------------------
// AspireSection
// ---------------------------------------------------------------------------

interface AspireSectionProps {
  selectedProperty: Property | null
  onSelectProperty: (p: Property | null) => void
  serviceLine: string
  onChangeServiceLine: (v: string) => void
  /** The branch already chosen in RequestorSection — reused, not asked twice. */
  branchCity: string | null
}

export function AspireSection({
  selectedProperty,
  onSelectProperty,
  serviceLine,
  onChangeServiceLine,
  branchCity,
}: AspireSectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        Aspire property &amp; service line
      </p>
      <div className="space-y-3">
        <PropertySelector value={selectedProperty} onSelect={onSelectProperty} branchCity={branchCity} />
        <ServiceLineSelect label="Service line" value={serviceLine} onChange={onChangeServiceLine} />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// RequestorSection — lead, branch, request date, and flags.
// Sales-author identity (requested by / phone / email) is not shown here;
// the modal still submits those fields, defaulted from the signed-in user.
// ---------------------------------------------------------------------------

interface RequestorSectionProps {
  form: FormState
  setStr: SetStr
  setBool: SetBool
  /** Aspire-derived install branch options. */
  branchOptions: BranchOption[]
}

export function RequestorSection({ form, setStr, setBool, branchOptions }: RequestorSectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        Request details
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ii-lead-id" className="text-xs">Lead ID</Label>
          <Input
            id="ii-lead-id"
            value={form.leadId}
            onChange={(e) => setStr('leadId', e.target.value)}
            placeholder="L-1234"
            className="h-8 text-xs"
          />
        </div>
        {/* Install branch — populated from Aspire config endpoint */}
        <div className="space-y-1">
          <Label htmlFor="ii-install-branch" className="text-xs">Install branch *</Label>
          <select
            id="ii-install-branch"
            value={form.installBranch}
            onChange={(e) => setStr('installBranch', e.target.value)}
            className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]"
          >
            <option value="">— select branch —</option>
            {branchOptions.map((b) => (
              <option key={b.aspire_branch_id} value={String(b.aspire_branch_id)}>{b.city}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-request-date" className="text-xs">Request date</Label>
          <Input
            id="ii-request-date"
            type="date"
            value={form.requestDate}
            onChange={(e) => setStr('requestDate', e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>
      {/* Checkboxes */}
      <div className="flex flex-wrap gap-4 mt-3">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            id="ii-new-client"
            type="checkbox"
            checked={form.isNewClient}
            onChange={(e) => setBool('isNewClient', e.target.checked)}
            className="h-3.5 w-3.5 accent-[#2E7D52]"
            aria-label="New client"
          />
          New client
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            id="ii-bond-required"
            type="checkbox"
            checked={form.isBondRequired}
            onChange={(e) => setBool('isBondRequired', e.target.checked)}
            className="h-3.5 w-3.5 accent-[#2E7D52]"
            aria-label="Bond required"
          />
          Bond required
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            id="ii-duplicate"
            type="checkbox"
            checked={form.isDuplicate}
            onChange={(e) => setBool('isDuplicate', e.target.checked)}
            className="h-3.5 w-3.5 accent-[#2E7D52]"
            aria-label="Duplicate"
          />
          Duplicate
          <span className="text-[10px] text-[hsl(var(--muted-fg))]">(feeds reporting-integrity exclusion — II-6.13)</span>
        </label>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// DatesProbabilitySection
// ---------------------------------------------------------------------------

interface DatesProbabilitySectionProps {
  form: FormState
  setStr: SetStr
}

export function DatesProbabilitySection({ form, setStr }: DatesProbabilitySectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        Dates &amp; Probability
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ii-internal-deadline" className="text-xs">Internal deadline</Label>
          <Input
            id="ii-internal-deadline"
            type="date"
            value={form.internalDeadline}
            onChange={(e) => setStr('internalDeadline', e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-client-deadline" className="text-xs">Client deadline</Label>
          <Input
            id="ii-client-deadline"
            type="date"
            value={form.clientDeadline}
            onChange={(e) => setStr('clientDeadline', e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-start-date" className="text-xs">Start date</Label>
          <Input
            id="ii-start-date"
            type="date"
            value={form.startDate}
            onChange={(e) => setStr('startDate', e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-anticipated-close" className="text-xs">Anticipated close</Label>
          <Input
            id="ii-anticipated-close"
            type="date"
            value={form.anticipatedClose}
            onChange={(e) => setStr('anticipatedClose', e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-win-probability" className="text-xs">Win probability (%) *</Label>
          <Input
            id="ii-win-probability"
            type="number"
            min={20}
            max={100}
            step={5}
            value={form.winProbabilityPct}
            onChange={(e) => setStr('winProbabilityPct', e.target.value)}
            required
            className="h-8 text-xs"
          />
          <p className="text-[10px] text-[hsl(var(--muted-fg))]">20–100%</p>
        </div>
      </div>
      {/* SLA note */}
      <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>
          <strong>14-calendar-day SLA</strong> — clock starts when sent to Estimating.
          Internal deadline defaults to +{SLA_CONFIG.returnWindowDays} calendar days if blank.
        </span>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// OpportunitySection
// ---------------------------------------------------------------------------

interface OpportunitySectionProps {
  form: FormState
  setStr: SetStr
  setServiceType: SetServiceType
}

export function OpportunitySection({ form, setStr, setServiceType }: OpportunitySectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        Opportunity
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ii-opportunity-name" className="text-xs">Opportunity name *</Label>
          <Input
            id="ii-opportunity-name"
            value={form.opportunityName}
            onChange={(e) => setStr('opportunityName', e.target.value)}
            placeholder="Greenfield Estate — Phase 1 Install"
            required
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-estimated-value" className="text-xs">Estimated value ($)</Label>
          <Input
            id="ii-estimated-value"
            type="number"
            min={0}
            value={form.estimatedValue}
            onChange={(e) => setStr('estimatedValue', e.target.value)}
            placeholder="250000"
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]"
          />
        </div>
        {/* Industry — native <select> */}
        <div className="space-y-1">
          <Label htmlFor="ii-industry" className="text-xs">Industry *</Label>
          <select
            id="ii-industry"
            value={form.industry}
            onChange={(e) => setStr('industry', e.target.value as InstallCustomerType)}
            required
            className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]"
          >
            <option value="commercial">Commercial</option>
            <option value="government">Government</option>
            <option value="land_residential">Land residential</option>
            <option value="home_residential">Home residential</option>
          </select>
        </div>
      </div>
      {/* Service types */}
      <div className="mt-3">
        <p className="text-xs font-medium mb-2">Service type(s)</p>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ['landscapeInstall', 'Landscape install'],
              ['irrigation', 'Irrigation'],
              ['hardscape', 'Hardscape'],
              ['gradingDrainage', 'Grading/drainage'],
              ['lighting', 'Lighting'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.serviceTypes[key]}
                onChange={(e) => setServiceType(key, e.target.checked)}
                className="h-3.5 w-3.5 accent-[#2E7D52]"
                aria-label={label}
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ClientSection
// ---------------------------------------------------------------------------

interface ClientSectionProps {
  form: FormState
  setStr: SetStr
}

export function ClientSection({ form, setStr }: ClientSectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        Client
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ii-company" className="text-xs">Company *</Label>
          <Input
            id="ii-company"
            value={form.company}
            onChange={(e) => setStr('company', e.target.value)}
            placeholder="Greenfield Development LLC"
            required
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-contact-person" className="text-xs">Contact person *</Label>
          <Input
            id="ii-contact-person"
            value={form.contactPerson}
            onChange={(e) => setStr('contactPerson', e.target.value)}
            placeholder="Morgan Pierce"
            required
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-client-email" className="text-xs">Client email address</Label>
          <Input
            id="ii-client-email"
            type="email"
            value={form.clientEmail}
            onChange={(e) => setStr('clientEmail', e.target.value)}
            placeholder="pierce@greenfield.com"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-client-phone" className="text-xs">Client phone number</Label>
          <Input
            id="ii-client-phone"
            type="tel"
            value={form.clientPhone}
            onChange={(e) => setStr('clientPhone', e.target.value)}
            placeholder="480-555-6789"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ii-client-address" className="text-xs">Client mailing address</Label>
          <Input
            id="ii-client-address"
            value={form.clientAddress}
            onChange={(e) => setStr('clientAddress', e.target.value)}
            placeholder="123 Office Park Blvd, Scottsdale, AZ 85251"
            className="h-8 text-xs"
          />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// LandscapeScopeSection
// ---------------------------------------------------------------------------

interface LandscapeScopeSectionProps {
  form: FormState
  setStr: SetStr
  setBool: SetBool
}

export function LandscapeScopeSection({ form, setStr, setBool }: LandscapeScopeSectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        Landscape Scope
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ii-planting-beds" className="text-xs">Planting beds (SF)</Label>
          <Input id="ii-planting-beds" type="number" min={0} value={form.plantingBedsSf}
            onChange={(e) => setStr('plantingBedsSf', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-trees" className="text-xs">Trees (count)</Label>
          <Input id="ii-trees" type="number" min={0} value={form.treesCount}
            onChange={(e) => setStr('treesCount', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-shrubs-groundcover" className="text-xs">Shrubs/groundcover (count)</Label>
          <Input id="ii-shrubs-groundcover" type="number" min={0} value={form.shrubsGroundcoverCount}
            onChange={(e) => setStr('shrubsGroundcoverCount', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-sod-turf" className="text-xs">Sod/turf (SF)</Label>
          <Input id="ii-sod-turf" type="number" min={0} value={form.sodTurfSf}
            onChange={(e) => setStr('sodTurfSf', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-mulch-dg" className="text-xs">Mulch/DG (CY)</Label>
          <Input id="ii-mulch-dg" type="number" min={0} value={form.mulchDgCy}
            onChange={(e) => setStr('mulchDgCy', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-hardscape-sf" className="text-xs">Hardscape area (SF)</Label>
          <Input id="ii-hardscape-sf" type="number" min={0} value={form.hardscapeSf}
            onChange={(e) => setStr('hardscapeSf', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-hardscape-type" className="text-xs">Hardscape type</Label>
          <select
            id="ii-hardscape-type"
            value={form.hardscapeType}
            onChange={(e) => setStr('hardscapeType', e.target.value)}
            className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]"
          >
            <option value="">— Select —</option>
            <option value="Pavers">Pavers</option>
            <option value="Stamped">Stamped</option>
            <option value="Flagstone">Flagstone</option>
            <option value="Retaining wall">Retaining wall</option>
            <option value="Mixed">Mixed</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-grading-cut-fill" className="text-xs">Grading/cut-fill (CY)</Label>
          <Input id="ii-grading-cut-fill" type="number" min={0} value={form.gradingCutFillCy}
            onChange={(e) => setStr('gradingCutFillCy', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-soil-amendment" className="text-xs">Soil amendment</Label>
          <Input id="ii-soil-amendment" value={form.soilAmendment}
            onChange={(e) => setStr('soilAmendment', e.target.value)}
            placeholder="Description or CY"
            className="h-8 text-xs" />
        </div>
      </div>
      {/* Landscape Yes/No toggles */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(
          [
            ['landscapePlanProvided', 'Landscape plan provided'],
            ['planTypeCodeMin', 'Plan type Code-min'],
            ['veOptions', 'VE options'],
            ['bidFormRequired', 'Bid form required'],
            ['bidBySchedule', 'Bid by schedule/take-off'],
            ['oneYrMaintenanceAgreement', '1-yr maintenance agreement'],
            ['vendorQuotesRequired', 'Vendor quotes req\'d'],
            ['subcontractorQuotesRequired', 'Subcontractor quotes req\'d'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form[key] as boolean}
              onChange={(e) => setBool(key, e.target.checked)}
              className="h-3.5 w-3.5 accent-[#2E7D52]"
            />
            {label}
          </label>
        ))}
      </div>
      <div className="mt-3 space-y-1">
        <Label htmlFor="ii-landscape-notes" className="text-xs">Notes</Label>
        <Textarea
          id="ii-landscape-notes"
          value={form.landscapeNotes}
          onChange={(e) => setStr('landscapeNotes', e.target.value)}
          placeholder="Additional landscape scope notes…"
          rows={2}
          className="text-xs"
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// IrrigationScopeSection
// ---------------------------------------------------------------------------

interface IrrigationScopeSectionProps {
  form: FormState
  setStr: SetStr
  setBool: SetBool
}

export function IrrigationScopeSection({ form, setStr, setBool }: IrrigationScopeSectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        Irrigation Scope
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label htmlFor="ii-irr-zones" className="text-xs">Zones</Label>
          <Input id="ii-irr-zones" type="number" min={0} value={form.irrZones}
            onChange={(e) => setStr('irrZones', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-controller-type" className="text-xs">Controller type</Label>
          <Input id="ii-controller-type" value={form.controllerType}
            onChange={(e) => setStr('controllerType', e.target.value)}
            placeholder="Smart / Standard"
            className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-water-source" className="text-xs">Water source</Label>
          <Input id="ii-water-source" value={form.waterSource}
            onChange={(e) => setStr('waterSource', e.target.value)}
            placeholder="Domestic / Reclaimed"
            className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-backflow-device" className="text-xs">Backflow device</Label>
          <Input id="ii-backflow-device" value={form.backflowDevice}
            onChange={(e) => setStr('backflowDevice', e.target.value)}
            className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-mainline-size" className="text-xs">Mainline size (in)</Label>
          <Input id="ii-mainline-size" type="number" min={0} step={0.25} value={form.mainlineSizeIn}
            onChange={(e) => setStr('mainlineSizeIn', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-static-pressure" className="text-xs">Static pressure (psi)</Label>
          <Input id="ii-static-pressure" type="number" min={0} value={form.staticPressurePsi}
            onChange={(e) => setStr('staticPressurePsi', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-meter-size" className="text-xs">Meter size (in)</Label>
          <Input id="ii-meter-size" type="number" min={0} step={0.25} value={form.meterSizeIn}
            onChange={(e) => setStr('meterSizeIn', e.target.value)}
            className="h-8 text-xs bg-[#eff6ff] border-[#bfdbfe]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-head-type" className="text-xs">Head type</Label>
          <Input id="ii-head-type" value={form.headType}
            onChange={(e) => setStr('headType', e.target.value)}
            placeholder="Rotor / Spray / Drip"
            className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ii-rain-flow-sensor" className="text-xs">Rain/flow sensor</Label>
          <Input id="ii-rain-flow-sensor" value={form.rainFlowSensor}
            onChange={(e) => setStr('rainFlowSensor', e.target.value)}
            placeholder="Rain Bird / Hunter"
            className="h-8 text-xs" />
        </div>
      </div>
      {/* Irrigation Yes/No toggles */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(
          [
            ['irrPlanProvided', 'Irrigation plan provided'],
            ['waterUsePermit', 'Water-use permit'],
            ['designRequired', 'Design required'],
            ['bidScheduleExists', 'Bid schedule exists'],
            ['pumpStationRequired', 'Pump station required'],
            ['pumpStationDesignProvided', 'Pump-station design provided'],
            ['fullCoverage', '100% coverage'],
            ['separation', 'Separation'],
            ['supplementalWell', 'Supplemental well'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form[key] as boolean}
              onChange={(e) => setBool(key, e.target.checked)}
              className="h-3.5 w-3.5 accent-[#2E7D52]"
            />
            {label}
          </label>
        ))}
      </div>
      {/* Material to irrigate */}
      <div className="mt-2">
        <p className="text-xs font-medium mb-1">Material to be irrigated</p>
        <div className="flex gap-4">
          {(
            [
              ['irrMaterialTrees', 'Trees (irrigated)'],
              ['irrMaterialShrubs', 'Shrubs (irrigated)'],
              ['irrMaterialSod', 'Sod (irrigated)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form[key] as boolean}
                onChange={(e) => setBool(key, e.target.checked)}
                className="h-3.5 w-3.5 accent-[#2E7D52]"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <Label htmlFor="ii-irr-notes" className="text-xs">Notes</Label>
        <Textarea
          id="ii-irr-notes"
          value={form.irrNotes}
          onChange={(e) => setStr('irrNotes', e.target.value)}
          placeholder="Additional irrigation scope notes…"
          rows={2}
          className="text-xs"
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// RfiSection
// ---------------------------------------------------------------------------

interface RfiSectionProps {
  form: FormState
  setStr: SetStr
}

export function RfiSection({ form, setStr }: RfiSectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        RFI Tracking
      </p>
      <p className="text-[10px] text-[hsl(var(--muted-fg))] mb-2">
        Track open RFIs to the GC — a bid isn't final until required RFIs are answered (II-6.2).
      </p>
      <div className="space-y-1">
        <Label htmlFor="ii-rfi-status" className="text-xs">RFI status</Label>
        <Textarea
          id="ii-rfi-status"
          value={form.rfiStatus}
          onChange={(e) => setStr('rfiStatus', e.target.value)}
          placeholder="e.g. Awaiting GC response on storm drain details (RFI #003, sent 2026-07-10)…"
          rows={3}
          className="text-xs"
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// TakeoffFilesSection
// ---------------------------------------------------------------------------

interface TakeoffFilesSectionProps {
  propertyMapFile: AttachedFile | null
  rfpFile: AttachedFile | null
  otherFiles: AttachedFile[]
  propertyMapRef: RefObject<HTMLInputElement | null>
  rfpRef: RefObject<HTMLInputElement | null>
  otherRef: RefObject<HTMLInputElement | null>
  onPropertyMapChange: (e: ChangeEvent<HTMLInputElement>) => void
  onRfpChange: (e: ChangeEvent<HTMLInputElement>) => void
  onOtherChange: (e: ChangeEvent<HTMLInputElement>) => void
  onClearPropertyMap: () => void
  onClearRfp: () => void
  onRemoveOther: (index: number) => void
}

export function TakeoffFilesSection({
  propertyMapFile,
  rfpFile,
  otherFiles,
  propertyMapRef,
  rfpRef,
  otherRef,
  onPropertyMapChange,
  onRfpChange,
  onOtherChange,
  onClearPropertyMap,
  onClearRfp,
  onRemoveOther,
}: TakeoffFilesSectionProps) {
  return (
    <section>
      <p className="text-xs font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide mb-2">
        Takeoff Files
      </p>
      <p className="text-[10px] text-[hsl(var(--muted-fg))] mb-3">
        Files are stored for the estimator to open — auto-population from uploads is future scope.
      </p>
      <div className="space-y-3">
        <FileAttachRow
          label="Property map / site plan"
          hint="PDF — site plan, property boundary map, civil drawings"
          file={propertyMapFile}
          testId="install-property-map-file-area"
          inputRef={propertyMapRef}
          accept="application/pdf"
          onChange={onPropertyMapChange}
          onClear={onClearPropertyMap}
        />
        <FileAttachRow
          label="RFP document"
          hint="PDF, Word (.doc, .docx), or Excel (.xls, .xlsx) — Request for Proposal or bid package"
          file={rfpFile}
          testId="install-rfp-file-area"
          inputRef={rfpRef}
          accept={RFP_FILE_ACCEPT}
          actionLabel="Attach file"
          onChange={onRfpChange}
          onClear={onClearRfp}
        />
        {/* Other files */}
        <div>
          <p className="text-xs font-medium mb-1">Attach other files</p>
          <p className="text-[10px] text-[hsl(var(--muted-fg))] mb-2">
            Civil drawings, plant schedule, spec sheets
          </p>
          <input
            ref={otherRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Attach other files"
            onChange={onOtherChange}
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
                    onClick={() => onRemoveOther(i)}
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
  )
}

// Suppress unused import warning — Button is not used in sections but kept
// available if callers need it via this module.
export { Button }
