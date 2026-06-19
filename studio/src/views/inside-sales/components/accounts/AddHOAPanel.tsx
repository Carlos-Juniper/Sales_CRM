import { useState } from 'react'
import { SlideOverPanel } from '@/components/shared/SlideOverPanel'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/TextField'
import { SelectField } from '@/components/ui/SelectField'
import type { HOAStatus, HOAProperty, ManagementCompany } from '@/types/accounts'
import type { CreateHOAPropertyPayload, PatchHOAPropertyPayload } from '@/api/hoaProperties'

const HOA_STATUSES: HOAStatus[] = ['Prospect', 'Bidding', 'Active', 'At Risk', 'Lost']

interface AddHOAPanelProps {
  isOpen: boolean
  onClose: () => void
  onSave: (body: CreateHOAPropertyPayload) => Promise<void>
  managementCompanies: ManagementCompany[]
  /** Present in edit mode — pre-fills the form and switches submit to PATCH */
  initialValues?: HOAProperty
  onUpdate?: (body: PatchHOAPropertyPayload) => Promise<void>
}

interface FormState {
  property_name: string
  association_name: string
  address: string
  city: string
  state: string
  zip: string
  county: string
  acreage: string
  units: string
  status: HOAStatus
  branch: string
  management_company_id: string
}

const INITIAL: FormState = {
  property_name: '',
  association_name: '',
  address: '',
  city: '',
  state: 'FL',
  zip: '',
  county: '',
  acreage: '',
  units: '',
  status: 'Prospect',
  branch: '',
  management_company_id: '',
}

function formFromProperty(p: HOAProperty): FormState {
  return {
    property_name: p.property_name,
    association_name: p.association_name ?? '',
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    county: p.county ?? '',
    acreage: p.acreage != null ? String(p.acreage) : '',
    units: p.units != null ? String(p.units) : '',
    status: p.status,
    branch: p.branch ?? '',
    management_company_id: p.management_company_id ?? '',
  }
}

export function AddHOAPanel({ isOpen, onClose, onSave, managementCompanies, initialValues, onUpdate }: AddHOAPanelProps) {
  const isEditMode = initialValues !== undefined
  const [form, setForm] = useState<FormState>(() =>
    isEditMode ? formFromProperty(initialValues) : INITIAL
  )
  const [saving, setSaving] = useState(false)

  const isValid = form.property_name.trim().length > 0

  function set(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
  }

  function handleClose() {
    // Reset to the baseline for this mode so reopening shows consistent state
    setForm(isEditMode ? formFromProperty(initialValues) : INITIAL)
    onClose()
  }

  async function handleSubmit() {
    if (!isValid) return
    setSaving(true)
    try {
      if (isEditMode && onUpdate) {
        await onUpdate({
          property_name: form.property_name.trim(),
          association_name: form.association_name.trim() || null,
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          zip: form.zip.trim(),
          county: form.county.trim() || null,
          estimated_acreage: form.acreage ? Number(form.acreage) : null,
          units: form.units ? Number(form.units) : null,
          status: form.status,
          branch_id: form.branch || null,
          management_company_id: form.management_company_id || null,
        })
      } else {
        await onSave({
          property_name: form.property_name.trim(),
          association_name: form.association_name.trim(),
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          zip: form.zip.trim(),
          county: form.county.trim(),
          acreage: form.acreage ? Number(form.acreage) : 0,
          units: form.units ? Number(form.units) : null,
          status: form.status,
          branch: form.branch || null,
          management_company_id: form.management_company_id || null,
        })
      }
      setForm(isEditMode ? formFromProperty(initialValues) : INITIAL)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOverPanel isOpen={isOpen} onClose={handleClose} title={isEditMode ? 'Edit HOA property' : 'Add HOA property'}>
      <div className="p-5 space-y-5">
        {/* Property details */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
            Property
          </p>

          <div className="space-y-2">
            <TextField
              label="Property name"
              required
              type="text"
              data-testid="property-name-input"
              value={form.property_name}
              onChange={set('property_name')}
              placeholder="Pelican Bay"
            />

            <TextField
              label="Association name"
              type="text"
              value={form.association_name}
              onChange={set('association_name')}
              placeholder="Pelican Bay Foundation, Inc."
            />
          </div>
        </section>

        {/* Location */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
            Location
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <TextField
                label="Street address"
                type="text"
                value={form.address}
                onChange={set('address')}
                placeholder="6620 Pelican Bay Blvd"
              />
            </div>

            <TextField
              label="City"
              type="text"
              value={form.city}
              onChange={set('city')}
              placeholder="Naples"
            />

            <TextField
              label="State"
              type="text"
              value={form.state}
              onChange={set('state')}
              placeholder="FL"
            />

            <TextField
              label="ZIP"
              type="text"
              value={form.zip}
              onChange={set('zip')}
              placeholder="34108"
            />

            <TextField
              label="County"
              type="text"
              value={form.county}
              onChange={set('county')}
              placeholder="Collier"
            />
          </div>
        </section>

        {/* Management company */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
            CRM
          </p>

          <SelectField
            label="Pipeline status"
            value={form.status}
            onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as HOAStatus }))}
          >
            {HOA_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </SelectField>

          <SelectField
            label="Management company"
            value={form.management_company_id}
            onChange={set('management_company_id')}
          >
            <option value="">Self-managed / none</option>
            {managementCompanies.map((co) => (
              <option key={co.id} value={co.id}>
                {co.company_name}
              </option>
            ))}
          </SelectField>
        </section>
      </div>

      {/* Footer */}
      <div className="border-t border-[hsl(var(--border))] px-5 py-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={handleClose} type="button">
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!isValid || saving}
          onClick={handleSubmit}
          type="button"
          className="ml-auto"
        >
          {isEditMode ? 'Save changes' : 'Create property'}
        </Button>
      </div>
    </SlideOverPanel>
  )
}
