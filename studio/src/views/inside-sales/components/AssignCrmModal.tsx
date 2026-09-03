import { useState } from 'react'
import { CheckCircle2, User } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AssigneeAvatar } from '@/components/shared/AssigneeAvatar'
import { useAssignLeadToCrm } from '@/hooks/useLeads'
import { useUsers } from '@/hooks/useBids'
import type { Lead } from '@/types'

interface AssignCrmModalProps {
  lead: Lead | null
  isOpen: boolean
  onClose: () => void
}

export function AssignCrmModal({ lead, isOpen, onClose }: AssignCrmModalProps) {
  const { data: crms = [] } = useUsers('sales')
  const assign = useAssignLeadToCrm()

  const [selectedCrmId, setSelectedCrmId] = useState('')
  const [notes, setNotes] = useState(lead?.handoff_notes ?? '')
  const [success, setSuccess] = useState(false)

  if (!lead) return null

  const selectedCrm = crms.find(c => c.id === selectedCrmId)

  async function handleSubmit() {
    if (!selectedCrmId) return
    try {
      await assign.mutateAsync({
        lead_id: lead!.id,
        assigned_to: selectedCrmId,
        handoff_notes: notes,
      })
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        setSelectedCrmId('')
        setNotes('')
        onClose()
      }, 2000)
    } catch {
      // error toast shown by useAssignLeadToCrm's onError
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        {success ? (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-base font-semibold text-[hsl(var(--fg))]">Lead Assigned</h3>
            <p className="text-sm text-[hsl(var(--muted-fg))] mt-1">
              {lead.property_name} assigned to {selectedCrm?.name}.<br />
              They will follow up within <span className="font-medium">24 hours</span>.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Assign to CRM</DialogTitle>
              <DialogDescription>
                Assign <span className="font-medium text-[hsl(var(--fg))]">{lead.property_name}</span> to the CRM who will own this relationship.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Assign to CRM</Label>
                <Select value={selectedCrmId} onValueChange={setSelectedCrmId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a CRM…" />
                  </SelectTrigger>
                  <SelectContent>
                    {crms.length === 0 ? (
                      <SelectItem value="_none" disabled>No CRMs available</SelectItem>
                    ) : (
                      crms.map((crm) => (
                        <SelectItem key={crm.id} value={crm.id}>
                          <div className="flex items-center gap-2">
                            <AssigneeAvatar user={crm} size="sm" />
                            <span>{crm.name}</span>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {selectedCrm && (
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-[hsl(var(--muted-fg))]">
                    <User className="h-3 w-3" />
                    <span>{selectedCrm.email}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Handoff notes</Label>
                <Textarea
                  placeholder="Context for the CRM — what you've learned, key contacts, any competitor info…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={5}
                />
                <p className="text-xs text-[hsl(var(--muted-fg))]">Pre-filled from AI lead summary. Edit as needed.</p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={!selectedCrmId || assign.isPending}
              >
                {assign.isPending ? 'Assigning…' : 'Assign'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
