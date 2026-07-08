import { useState, useRef } from 'react'
import { X, Check, Mail, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOutreachContacts } from '@/hooks/useLeads'
import { cn } from '@/lib/utils'
import type { OutreachContact } from '@/types'

interface ContactPickerProps {
  open: boolean
  onClose: () => void
  onConfirm: (contacts: { id: string; name: string }[]) => void
}

interface FreeformRecipient {
  id: string
  name: string
  isFreeform: true
  kind: 'email' | 'phone'
}

function looksLikeEmail(s: string): boolean {
  return s.includes('@') && s.length > 3
}

function looksLikePhone(s: string): boolean {
  return /^[\d\s\-\(\)\+]{7,}$/.test(s.trim())
}

function detectKind(s: string): 'email' | 'phone' | null {
  if (looksLikeEmail(s)) return 'email'
  if (looksLikePhone(s)) return 'phone'
  return null
}

const AVATAR_COLORS = ['#2E7D52', '#1d4ed8', '#b45309', '#7e22ce', '#0f766e', '#be123c', '#4338ca']

function chipColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function chipInitials(name: string): string {
  return name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()
}

export function ContactPicker({ open, onClose, onConfirm }: ContactPickerProps) {
  const { data: contacts = [], isLoading } = useOutreachContacts()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inputValue, setInputValue] = useState('')
  const [freeformRecipients, setFreeformRecipients] = useState<FreeformRecipient[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputError, setInputError] = useState(false)

  if (!open) return null

  const allSelected = contacts.filter((c: OutreachContact) => selected.has(c.id))
  const canConfirm = selected.size > 0 || freeformRecipients.length > 0

  const filteredContacts = contacts.filter((c: OutreachContact) =>
    !inputValue ||
    c.name.toLowerCase().includes(inputValue.toLowerCase()) ||
    c.company.toLowerCase().includes(inputValue.toLowerCase()) ||
    c.email?.toLowerCase().includes(inputValue.toLowerCase())
  )

  const grouped = filteredContacts.reduce<Record<string, OutreachContact[]>>((acc, c) => {
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

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = inputValue.trim().replace(/,$/, '')
      if (!val) return
      const kind = detectKind(val)
      if (kind) {
        const id = `free-${val}`
        if (!freeformRecipients.find(r => r.id === id)) {
          setFreeformRecipients(prev => [...prev, { id, name: val, isFreeform: true, kind }])
        }
        setInputValue('')
        setInputError(false)
      } else {
        setInputError(true)
      }
    }
    if (e.key === 'Backspace' && inputValue === '') {
      if (freeformRecipients.length > 0) {
        setFreeformRecipients(prev => prev.slice(0, -1))
      } else if (selected.size > 0) {
        const lastId = Array.from(selected).pop()!
        setSelected(prev => { const next = new Set(prev); next.delete(lastId); return next })
      }
    }
  }

  function handleConfirm() {
    const contactObjs = allSelected.map(c => ({ id: c.id, name: c.name }))
    const freeformObjs = freeformRecipients.map(r => ({ id: r.id, name: r.name }))
    onConfirm([...contactObjs, ...freeformObjs])
    setSelected(new Set())
    setFreeformRecipients([])
    setInputValue('')
    setInputError(false)
  }

  function handleClose() {
    setSelected(new Set())
    setFreeformRecipients([])
    setInputValue('')
    setInputError(false)
    onClose()
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="New message" className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-[hsl(var(--card))] rounded-2xl shadow-2xl border border-[hsl(var(--border))] flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[hsl(var(--border))] flex-shrink-0">
          <h2 className="text-[15px] font-bold text-[hsl(var(--fg))]">New message</h2>
          <div className="flex-1" />
          <button type="button" onClick={handleClose} className="p-1 rounded hover:bg-[hsl(var(--muted))]">
            <X className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
          </button>
        </div>

        {/* To: field — chips + inline input */}
        <div
          className="px-5 py-3 border-b border-[hsl(var(--border))] flex-shrink-0"
          onClick={() => inputRef.current?.focus()}
        >
          <div className="flex flex-wrap gap-1.5 items-center min-h-[32px]">
            <span className="text-[12.5px] font-semibold text-[hsl(var(--muted-fg))] self-center">To</span>

            {/* Contact chips */}
            {allSelected.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 py-1 pl-1 pr-1.5 rounded-full bg-[#2E7D52]/[0.10] text-[#2E7D52] text-xs font-semibold"
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                  style={{ background: chipColor(c.name) }}
                >
                  {chipInitials(c.name)}
                </span>
                {c.name}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggle(c.id) }}
                  className="opacity-60 hover:opacity-100 inline-flex"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}

            {/* Freeform chips */}
            {freeformRecipients.map((r) => (
              <span
                key={r.id}
                className="inline-flex items-center gap-1.5 py-1 pl-1.5 pr-1.5 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--fg))] text-xs font-semibold border border-[hsl(var(--border))]"
              >
                {r.kind === 'email'
                  ? <Mail className="h-3 w-3 text-[hsl(var(--muted-fg))]" />
                  : <Phone className="h-3 w-3 text-[hsl(var(--muted-fg))]" />
                }
                {r.name}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFreeformRecipients(p => p.filter(x => x.id !== r.id)) }}
                  className="opacity-60 hover:opacity-100 inline-flex"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}

            {/* Inline input */}
            <input
              ref={inputRef}
              type="text"
              aria-label="To field"
              placeholder={canConfirm ? '' : 'Add email, phone, or search contacts…'}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setInputError(false) }}
              onFocus={() => {}}
              onKeyDown={handleInputKeyDown}
              className="flex-1 min-w-[140px] border-none outline-none text-sm bg-transparent text-[hsl(var(--fg))] placeholder:text-[hsl(var(--muted-fg))] py-0.5"
            />
          </div>

          {/* Enter-to-add affordance */}
          {inputValue && detectKind(inputValue) && (
            <div className="mt-1.5">
              <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[#2E7D52] font-medium">
                Press Enter to add
                <span className="font-semibold">{inputValue.trim()}</span>
                <span className="text-[hsl(var(--muted-fg))]">&#x21B5;</span>
              </span>
            </div>
          )}
          {inputError && (
            <div className="mt-1.5">
              <span className="text-[11.5px] text-red-500 font-medium">
                Enter a valid email address or phone number
              </span>
            </div>
          )}
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 rounded animate-pulse bg-[hsl(var(--muted))]" />
              ))}
            </div>
          ) : Object.keys(grouped).length === 0 && !inputValue ? (
            <div className="p-4 text-center text-sm text-[hsl(var(--muted-fg))]">
              No contacts found
            </div>
          ) : (
            Object.entries(grouped).map(([company, companyContacts]) => (
              <div key={company}>
                <p className="px-5 pt-3 pb-1 text-[10px] font-extrabold uppercase tracking-[.08em] text-[hsl(var(--muted-fg))]">
                  {company}
                </p>
                {companyContacts.map((c) => {
                  const isOn = selected.has(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c.id)}
                      className={cn(
                        'w-full text-left flex items-center gap-2.5 px-5 py-[9px] transition-colors',
                        'hover:bg-[hsl(var(--muted))]',
                        isOn && 'text-[#2E7D52]'
                      )}
                    >
                      <div
                        className="w-[30px] h-[30px] rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
                        style={{ background: chipColor(c.name) }}
                      >
                        {chipInitials(c.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-[13px] font-semibold', isOn ? 'text-[#2E7D52]' : 'text-[hsl(var(--fg))]')}>
                          {c.name}
                        </p>
                        <p className="text-[11px] text-[hsl(var(--muted-fg))] truncate">{c.title} · {c.email}</p>
                      </div>
                      {/* Checkmark */}
                      <div className={cn(
                        'w-[18px] h-[18px] rounded-md border-[1.5px] flex items-center justify-center flex-shrink-0',
                        isOn
                          ? 'bg-[#2E7D52] border-[#2E7D52] text-white'
                          : 'border-[hsl(var(--border))]'
                      )}>
                        {isOn && <Check className="h-3 w-3" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))] flex-shrink-0">
          <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
          <Button
            size="sm"
            className="bg-[#2E7D52] hover:bg-[#256644] text-white"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            Confirm{canConfirm ? ` (${selected.size + freeformRecipients.length})` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
