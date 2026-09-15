// ---------------------------------------------------------------------------
// ChapterReorderPanel — drag-and-drop chapter reorder, opened from the
// full-screen preview's toolbar (ProposalPreviewRoute).
//
// Operates on chapter keys + titles only (lib/proposal/chapters.ts) — never on
// page JSX. ProposalPreview.tsx independently resolves the same persisted
// chapterOrder against the same natural chapter list, so the two cannot drift:
// saving here just writes the new key order to the proposal, and the next
// render (in this tab, and in /proposals/:id/print) picks it up.
//
// Cover, Intro Letter, and Closing are locked and never appear in this list —
// the caller is expected to only pass reorderable body chapter keys.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X, Loader2 } from 'lucide-react'
import { chapterTitle } from '@/lib/proposal/chapters'
import { useUpdateProposal } from '@/hooks/useProposals'

interface ChapterReorderPanelProps {
  proposalId: string
  /** Current resolved order — natural default, reconciled against any saved chapterOrder. */
  chapterKeys: string[]
  onClose: () => void
}

function SortableRow({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg))] px-3 py-2 text-sm text-[hsl(var(--fg))] ${
        isDragging ? 'opacity-60' : ''
      }`}
      data-testid={`chapter-row-${id}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${chapterTitle(id)}`}
        className="cursor-grab touch-none text-[hsl(var(--muted-fg))] active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span>{chapterTitle(id)}</span>
    </li>
  )
}

export function ChapterReorderPanel({ proposalId, chapterKeys, onClose }: ChapterReorderPanelProps) {
  const [order, setOrder] = useState(chapterKeys)
  const updateMutation = useUpdateProposal()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id))
      const newIndex = prev.indexOf(String(over.id))
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  async function handleSave() {
    await updateMutation.mutateAsync({ id: proposalId, patch: { chapterOrder: order } })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Arrange pages"
    >
      <div className="w-full max-w-md rounded-xl bg-[hsl(var(--bg))] p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[hsl(var(--fg))]">Arrange pages</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-[hsl(var(--muted-fg))]">
          Drag a section to reorder it. The Cover, Intro Letter, and Closing pages always stay in
          place.
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ol className="flex max-h-96 flex-col gap-1.5 overflow-y-auto" data-testid="chapter-reorder-list">
              {order.map((key) => (
                <SortableRow key={key} id={key} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={updateMutation.isPending}
            data-testid="chapter-reorder-save"
            className="inline-flex items-center gap-2 rounded-lg bg-[#2E7D52] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save order
          </button>
        </div>
      </div>
    </div>
  )
}
