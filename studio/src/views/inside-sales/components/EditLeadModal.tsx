import { useState } from 'react'
import { useUpdateLead } from '@/hooks/useLeads'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { LEAD_TYPES } from '@/types'
import type { Lead } from '@/types'

interface EditLeadModalProps {
  lead: Lead
  open: boolean
  onClose: () => void
}

export function EditLeadModal({ lead, open, onClose }: EditLeadModalProps) {
  const updateLead = useUpdateLead()

  const [form, setForm] = useState({
    property_name: lead.property_name ?? '',
    lead_type: lead.lead_type,
    address: lead.address ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    zip: lead.zip ?? '',
    estimated_acreage: lead.estimated_acreage != null ? String(lead.estimated_acreage) : '',
    estimated_contract_value: lead.estimated_contract_value != null ? String(lead.estimated_contract_value) : '',
    units: lead.units != null ? String(lead.units) : '',
    bid_deadline: lead.bid_deadline ?? '',
    contact_name: lead.contact_name ?? '',
    contact_email: lead.contact_email ?? '',
  })

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        body: {
          property_name: form.property_name || undefined,
          lead_type: form.lead_type,
          address: form.address || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          zip: form.zip || undefined,
          estimated_acreage: form.estimated_acreage ? parseFloat(form.estimated_acreage) : undefined,
          estimated_contract_value: form.estimated_contract_value ? parseFloat(form.estimated_contract_value) : undefined,
          units: form.units ? parseInt(form.units) : undefined,
          bid_deadline: form.bid_deadline || undefined,
          contact_name: form.contact_name || undefined,
          contact_email: form.contact_email || undefined,
        },
      })
      onClose()
    } catch {
      // error toast handled by useUpdateLead
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit lead details</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Property name */}
          <div className="space-y-1">
            <Label className="text-xs">Property name</Label>
            <Input
              value={form.property_name}
              onChange={(e) => set('property_name', e.target.value)}
              placeholder="Silverleaf HOA"
              className="h-8 text-xs"
            />
          </div>

          {/* Lead type */}
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

          {/* Address */}
          <div className="space-y-1">
            <Label className="text-xs">Street address</Label>
            <Input
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="123 Main St"
              className="h-8 text-xs"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1 col-span-1">
              <Label className="text-xs">City</Label>
              <Input
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="Phoenix"
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
            <div className="space-y-1">
              <Label className="text-xs">ZIP</Label>
              <Input
                value={form.zip}
                onChange={(e) => set('zip', e.target.value)}
                placeholder="85001"
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Deal info */}
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
                step="0.1"
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
            <Label className="text-xs">Response deadline</Label>
            <Input
              type="date"
              value={form.bid_deadline}
              onChange={(e) => set('bid_deadline', e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          {/* Contact */}
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
            <Button type="submit" size="sm" disabled={updateLead.isPending}>
              {updateLead.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
