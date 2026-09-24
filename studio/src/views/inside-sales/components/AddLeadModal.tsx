import { useState } from 'react'
import { useCreateLead } from '@/hooks/useLeads'
import { useBranchList } from '@/hooks/useBranchList'
import { ApiError } from '@/api/client'
import { LEAD_NOTES_MAX_LENGTH } from '@/api/leads'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { LEAD_TYPES } from '@/types'
import type { LeadStatus, LeadType } from '@/types'
import { LEAD_TYPE_LABELS } from '@/lib/constants'
import type { Property } from '@/types/estimating'
import { stageForStatus } from '@/lib/pipelineStages'
import { PropertySelector } from './estimating/PropertySelector'

/** 422 loc ["body","notes"] — the form has no per-field server-error map, so this feeds the existing alert. */
function notesValidationMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null
  const issue = err.issues.find((item) => item.loc[0] === 'body' && item.loc[1] === 'notes')
  return issue?.msg ?? null
}

interface AddLeadModalProps {
  open: boolean
  defaultStatus: LeadStatus
  onClose: () => void
}

export function AddLeadModal({ open, defaultStatus, onClose }: AddLeadModalProps) {
  const createLead = useCreateLead()
  const { data: branches } = useBranchList()

  const INITIAL_FORM = {
    lead_type: 'HOA' as LeadType,
    estimated_contract_value: '',
    estimated_acreage: '',
    units: '',
    contact_name: '',
    contact_email: '',
    notes: '',
  }
  const [form, setForm] = useState(INITIAL_FORM)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [branchId, setBranchId] = useState<string>('')
  const [validationError, setValidationError] = useState<string | null>(null)

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!selectedProperty) {
      setValidationError('Please select a property before submitting.')
      return
    }
    if (!branchId) {
      setValidationError('Please select a branch before submitting.')
      return
    }
    setValidationError(null)

    const notes = form.notes.trim()

    try {
      await createLead.mutateAsync({
        // Property fields sourced from the selected property.
        property_id: selectedProperty.id,
        property_name: selectedProperty.name,
        city: selectedProperty.city ?? '',
        state: selectedProperty.state ?? '',
        lead_type: form.lead_type,
        estimated_contract_value: parseFloat(form.estimated_contract_value) || 0,
        estimated_acreage: parseFloat(form.estimated_acreage) || 0,
        status: defaultStatus,
        units: parseInt(form.units) || undefined,
        contact_name: form.contact_name || undefined,
        contact_email: form.contact_email || undefined,
        branch_id: branchId,
        // Blank notes are omitted (JSON drops undefined). The API stores NULL.
        notes: notes || undefined,
      })
      setForm(INITIAL_FORM)
      setSelectedProperty(null)
      setBranchId('')
      onClose()
    } catch (err) {
      // No per-field server-error pattern on this form. A notes 422 reuses the
      // existing alert; useCreateLead still toasts error.message.
      const notesMessage = notesValidationMessage(err)
      if (notesMessage) setValidationError(notesMessage)
    }
  }

  const colLabel = stageForStatus(defaultStatus)?.label ?? defaultStatus

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add lead to {colLabel}</DialogTitle>
          <DialogDescription>
            Create a manual lead. A property and branch are required.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Property — required; replaces the old property_name/address/city/state fields */}
          <div className="space-y-1">
            <Label className="text-xs">Property *</Label>
            <PropertySelector
              value={selectedProperty}
              onSelect={setSelectedProperty}
              origin={{ sourceType: 'manual' }}
            />
          </div>

          {/* Branch picker — required */}
          <div className="space-y-1">
            <Label htmlFor="add-lead-branch" className="text-xs">Branch *</Label>
            <select
              id="add-lead-branch"
              aria-label="Branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-2 text-xs text-[hsl(var(--fg))] focus:outline-none focus:ring-2 focus:ring-[#2E7D52]"
            >
              <option value="">Select branch…</option>
              {(branches ?? []).map((b) => (
                <option key={b.aspireBranchId} value={String(b.aspireBranchId)}>
                  {b.city ?? b.branchName}
                </option>
              ))}
            </select>
          </div>

          {/* Validation error */}
          {validationError && (
            <p role="alert" className="text-xs text-red-600">{validationError}</p>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Lead type</Label>
            <div className="flex gap-2">
              {LEAD_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('lead_type', t)}
                  className={cn(
                    'flex-1 py-1 rounded-md text-xs font-medium border transition-colors',
                    form.lead_type === t
                      ? 'bg-[#2E7D52] text-white border-[#2E7D52]'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--muted-fg))] hover:border-[#2E7D52]/50'
                  )}
                >
                  {LEAD_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Contract value ($)</Label>
              <Input
                type="number"
                value={form.estimated_contract_value}
                onChange={(e) => set('estimated_contract_value', e.target.value)}
                placeholder="150000"
                min={0}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Acreage</Label>
              <Input
                type="number"
                value={form.estimated_acreage}
                onChange={(e) => set('estimated_acreage', e.target.value)}
                placeholder="25"
                min={0}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Units</Label>
              <Input
                type="number"
                value={form.units}
                onChange={(e) => set('units', e.target.value)}
                placeholder="240"
                min={0}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Contact name</Label>
            <Input
              value={form.contact_name}
              onChange={(e) => set('contact_name', e.target.value)}
              placeholder="Jane Smith"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Contact email</Label>
            <Input
              type="email"
              value={form.contact_email}
              onChange={(e) => set('contact_email', e.target.value)}
              placeholder="jane@example.com"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="add-lead-notes" className="text-xs">Notes</Label>
              <span
                id="add-lead-notes-count"
                className={cn(
                  'text-[10px] tabular-nums',
                  form.notes.length > LEAD_NOTES_MAX_LENGTH
                    ? 'text-red-500'
                    : 'text-[hsl(var(--muted-fg))]',
                )}
              >
                {form.notes.length}/{LEAD_NOTES_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="add-lead-notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              maxLength={LEAD_NOTES_MAX_LENGTH}
              rows={3}
              placeholder="Add internal notes about this lead…"
              aria-describedby="add-lead-notes-count"
              className="text-xs"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={createLead.isPending}>
              {createLead.isPending ? 'Adding…' : 'Add lead'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
