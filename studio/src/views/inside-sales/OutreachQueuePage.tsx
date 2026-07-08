import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { ListPane } from './components/outreach/ListPane'
import { ConversationPane } from './components/outreach/ConversationPane'
import { ContactPicker } from './components/outreach/ContactPicker'
import { Composer } from './components/outreach/Composer'

export default function OutreachQueuePage() {
  const selectedLeadId = useUIStore((s) => s.selectedLeadId)
  const selectLead = useUIStore((s) => s.selectLead)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [pickerContacts, setPickerContacts] = useState<{ id: string; name: string }[]>([])

  const activeId = selectedLeadId ?? null

  function handleSelectLead(id: string) {
    selectLead(id === activeId ? null : id)
  }

  function handleConfirmContacts(contacts: { id: string; name: string }[]) {
    setPickerContacts(contacts)
    setPickerOpen(false)
    setComposerOpen(true)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: List pane (~372px) ── */}
        <div className="w-[372px] flex-shrink-0 border-r border-[hsl(var(--border))] flex flex-col overflow-hidden bg-[hsl(var(--card))]">
          <ListPane
            selectedLeadId={activeId}
            onSelectLead={handleSelectLead}
            onNewMessage={() => setPickerOpen(true)}
          />
        </div>

        {/* ── Right: Conversation pane ── */}
        <div className="flex-1 overflow-hidden bg-[hsl(var(--background))]">
          {activeId ? (
            <ConversationPane
              key={activeId}
              leadId={activeId}
              onOpenFullComposer={() => setComposerOpen(true)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <MessageSquare className="h-10 w-10 text-[hsl(var(--muted-fg))] opacity-40" />
              <p className="text-sm text-[hsl(var(--muted-fg))]">
                Select a conversation to get started
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Contact picker modal */}
      <ContactPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={handleConfirmContacts}
      />

      {/* Full composer modal */}
      {composerOpen && (
        <Composer
          leadId={activeId}
          initialRecipients={pickerContacts.length > 0 ? pickerContacts : undefined}
          onClose={() => { setComposerOpen(false); setPickerContacts([]) }}
        />
      )}
    </div>
  )
}
