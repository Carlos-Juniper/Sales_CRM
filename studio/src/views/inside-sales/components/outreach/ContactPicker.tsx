import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOutreachContacts } from '@/hooks/useLeads'
import { cn } from '@/lib/utils'
import type { OutreachContact } from '@/types'

interface ContactPickerProps {
  open: boolean
  onClose: () => void
  onConfirm: (contactIds: string[]) => void
}

export function ContactPicker({ open, onClose, onConfirm }: ContactPickerProps) {
  const { data: contacts = [], isLoading } = useOutreachContacts()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (!open) return null

  const filtered = contacts.filter((c: OutreachContact) =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company.toLowerCase().includes(search.toLowerCase())
  )

  // Group by company
  const grouped = filtered.reduce<Record<string, OutreachContact[]>>((acc, c) => {
    if (!acc[c.company]) acc[c.company] = []
    acc[c.company].push(c)
    return acc
  }, {})

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleConfirm() {
    onConfirm(Array.from(selected))
    setSelected(new Set())
    setSearch('')
  }

  function handleClose() {
    setSelected(new Set())
    setSearch('')
    onClose()
  }

  const selectedContacts = contacts.filter((c: OutreachContact) => selected.has(c.id))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New message"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
      />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-[hsl(var(--card))] rounded-xl shadow-xl border border-[hsl(var(--border))] flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] flex-shrink-0">
          <h2 className="text-sm font-bold text-[hsl(var(--fg))]">New message</h2>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={handleClose}
            className="p-1 rounded hover:bg-[hsl(var(--muted))]"
          >
            <X className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
          </button>
        </div>

        {/* To field — selected chips */}
        {selectedContacts.length > 0 && (
          <div
            role="list"
            aria-label="Selected recipients"
            className="px-4 py-2 border-b border-[hsl(var(--border))] flex flex-wrap gap-1.5 flex-shrink-0"
          >
            <span className="text-xs text-[hsl(var(--muted-fg))] self-center mr-1">To:</span>
            {selectedContacts.map((c) => (
              <span
                key={c.id}
                role="listitem"
                aria-label={c.name}
                data-chip={c.name}
                className="inline-flex items-center gap-1 text-xs bg-[#2E7D52]/10 text-[#2E7D52] px-2 py-0.5 rounded-full font-medium"
              >
                {`✓ ${c.name}`}
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  onClick={() => toggle(c.id)}
                  className="hover:text-[#2E7D52]/60"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="px-4 py-2 border-b border-[hsl(var(--border))] flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-fg))]" />
            <input
              role="searchbox"
              type="search"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]"
            />
          </div>
        </div>

        {/* Contacts list */}
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label="Contacts"
          className="flex-1 overflow-y-auto"
        >
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 rounded animate-pulse bg-[hsl(var(--muted))]" />
              ))}
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <div className="p-4 text-center text-sm text-[hsl(var(--muted-fg))]">
              No contacts found
            </div>
          ) : (
            Object.entries(grouped).map(([company, companyContacts]) => (
              <div
                key={company}
                role="group"
                aria-label={company}
                data-group={company}
                className="mb-1"
              >
                <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-[hsl(var(--muted-fg))]">
                  {company}
                </p>
                {companyContacts.map((c) => {
                  const isSelected = selected.has(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      onClick={() => toggle(c.id)}
                      aria-selected={isSelected}
                      className={cn(
                        'w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors hover:bg-[hsl(var(--muted))]',
                        isSelected && 'bg-[#2E7D52]/5'
                      )}
                    >
                      <div className={cn(
                        'h-8 w-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold',
                        isSelected ? 'bg-[#2E7D52] text-white' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-fg))]'
                      )}>
                        {c.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[hsl(var(--fg))] truncate">{c.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-fg))] truncate">{c.title}</p>
                      </div>
                      {isSelected && (
                        <div className="h-4 w-4 rounded-full bg-[#2E7D52] flex items-center justify-center flex-shrink-0">
                          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))] flex-shrink-0">
          <Button variant="outline" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-[#2E7D52] hover:bg-[#256644] text-white"
            onClick={handleConfirm}
            disabled={selected.size === 0}
          >
            Confirm{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
