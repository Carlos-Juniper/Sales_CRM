import { useState } from 'react'
import { useCreateLead } from '@/hooks/useLeads'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { LeadStatus, LeadType } from '@/types'

const LEAD_TYPES: LeadType[] = ['HOA', 'commercial', 'commercial']

const COLUMN_TITLES: Partial<Record<LeadStatus, string>> = {
  new: 'New Leads',
  contacted: 'Contacted',
  proposal_sent: 'Proposal Sent',
}

interface AddLeadModalProps {
  open: boolean
  defaultStatus: LeadStatus
  onClose: () => void
}

export function AddLeadModal({ open, defaultStatus, onClose }: AddLeadModalProps) {
  const createLead = useCreateLead()
  const [form, setForm] = useState({
    property_name: '',
    city: '',
    state: 'AZ',
    lead_type: 'HOA' as LeadType,
    estimated_contract_value: '',
    estimated_acreage: '',
    contact_name: '',
    contact_email: '',
  })

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await createLead.mutateAsync({
        property_name: form.property_name,
        city: form.city,
        state: form.state,
        lead_type: form.lead_type,
        estimated_contract_value: parseFloat(form.estimated_contract_value) || 0,
        estimated_acreage: parseFloat(form.estimated_acreage) || 0,
        status: defaultStatus,
        contact_name: form.contact_name || undefined,
        contact_email: form.contact_email || undefined,
      })
      setForm({ property_name: '', city: '', state: 'AZ', lead_type: 'HOA', estimated_contract_value: '', estimated_acreage: '', contact_name: '', contact_email: '' })
      onClose()
    } catch {
      // error toast shown by useCreateLead's onError
    }
  }

  const colLabel = COLUMN_TITLES[defaultStatus] ?? defaultStatus

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add lead to {colLabel}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Property name *</Label>
            <Input
              value={form.property_name}
              onChange={(e) => set('property_name', e.target.value)}
              placeholder="Silverleaf HOA"
              required
              className="h-8 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">City *</Label>
              <Input
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="Phoenix"
                required
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">State</Label>
              <Input
                value={form.state}
                onChange={(e) => set('state', e.target.value)}
                placeholder="AZ"
                className="h-8 text-xs"
              />
            </div>
          </div>

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
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
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
