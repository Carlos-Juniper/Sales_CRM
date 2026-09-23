// ---------------------------------------------------------------------------
// NewProposalPackageDialog — Proposals-page entry into the shared generator.
//
// Renders the same ProposalBuilder the lead panel uses. pickLead makes the
// rep attach a lead (and, through that form, a property) before submit.
// ---------------------------------------------------------------------------

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ProposalBuilder } from './estimating/ProposalBuilder'

interface NewProposalPackageDialogProps {
  open: boolean
  onClose: () => void
}

export function NewProposalPackageDialog({ open, onClose }: NewProposalPackageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Proposal Package</DialogTitle>
          <DialogDescription>
            Same generator used on a lead. Attach a lead and a property before saving.
          </DialogDescription>
        </DialogHeader>
        {open && <ProposalBuilder lead={null} pickLead showHeader={false} />}
      </DialogContent>
    </Dialog>
  )
}
