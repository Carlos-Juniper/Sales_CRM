import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DeleteLeadDialogProps {
  isOpen: boolean
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
}

export function DeleteLeadDialog({ isOpen, isPending, onConfirm, onClose }: DeleteLeadDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent role="alertdialog" aria-modal="true" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete lead?</DialogTitle>
          <DialogDescription>
            Remove this lead? It won't appear in any views and won't be re-scraped.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
