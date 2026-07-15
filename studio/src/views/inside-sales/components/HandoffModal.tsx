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
import { useHandoffLead } from '@/hooks/useLeads'
import { useUsers } from '@/hooks/useBids'
import { ASPIRE_DIVISIONS } from '@/lib/constants'
import type { Lead } from '@/types'

interface HandoffModalProps {
  lead: Lead | null
  isOpen: boolean
  onClose: () => void
}

export function HandoffModal({ lead, isOpen, onClose }: HandoffModalProps) {
  const { data: reps = [] } = useUsers('outside_sales')
  const handoff = useHandoffLead()

  const [selectedRepId, setSelectedRepId] = useState('')
  const [divisionId, setDivisionId] = useState<number | null>(lead?.division_id ?? null)
  const [notes, setNotes] = useState(lead?.handoff_notes ?? '')
  const [success, setSuccess] = useState(false)

  if (!lead) return null

  const selectedRep = reps.find(r => r.id === selectedRepId)

  async function handleSubmit() {
    if (!selectedRepId || divisionId == null) return
    try {
      await handoff.mutateAsync({
        lead_id: lead!.id,
        assigned_to: selectedRepId,
        handoff_notes: notes,
        division_id: divisionId,
      })
      setSuccess(true)
      setTimeout(() => {
        setSuccess(false)
        setSelectedRepId('')
        setDivisionId(null)
        setNotes('')
        onClose()
      }, 2000)
    } catch {
      // error toast shown by useHandoffLead's onError
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
            <h3 className="text-base font-semibold text-[hsl(var(--fg))]">Handoff Complete</h3>
            <p className="text-sm text-[hsl(var(--muted-fg))] mt-1">
              {lead.property_name} assigned to {selectedRep?.name}.<br />
              They will follow up within <span className="font-medium">24 hours</span>.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Hand Off to Estimating Team</DialogTitle>
              <DialogDescription>
                Assign <span className="font-medium text-[hsl(var(--fg))]">{lead.property_name}</span> to a field rep for site walk and proposal.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="division-select">Division</Label>
                <Select
                  value={divisionId != null ? String(divisionId) : ''}
                  onValueChange={(v) => setDivisionId(v ? parseInt(v, 10) : null)}
                >
                  <SelectTrigger id="division-select">
                    <SelectValue placeholder="Select a division…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPIRE_DIVISIONS.map((div) => (
                      <SelectItem key={div.value} value={String(div.value)}>
                        {div.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedRepId && divisionId == null && (
                  <p className="text-xs text-red-600">Select a division before handing off.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Assign to rep</Label>
                <Select value={selectedRepId} onValueChange={setSelectedRepId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select estimating team rep…" />
                  </SelectTrigger>
                  <SelectContent>
                    {reps.length === 0 ? (
                      <SelectItem value="_none" disabled>No reps available</SelectItem>
                    ) : (
                      reps.map((rep) => (
                        <SelectItem key={rep.id} value={rep.id}>
                          <div className="flex items-center gap-2">
                            <AssigneeAvatar user={rep} size="sm" />
                            <span>{rep.name}</span>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {selectedRep && (
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-[hsl(var(--muted-fg))]">
                    <User className="h-3 w-3" />
                    <span>{selectedRep.email}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Handoff notes</Label>
                <Textarea
                  placeholder="Context for the field rep — what you've learned, key contacts, any competitor info…"
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
                disabled={!selectedRepId || divisionId == null || handoff.isPending}
              >
                {handoff.isPending ? 'Handing off…' : 'Hand Off'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
