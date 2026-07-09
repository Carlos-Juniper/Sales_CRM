import { useState, useRef, useEffect } from 'react'
import {
  Mail, MessageSquare, X, Send, Clock,
  Bold, Italic, Underline, List, ChevronDown, Info
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLead, useSendOutreach } from '@/hooks/useLeads'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

interface ComposerProps {
  leadId: string | null
  initialRecipients?: { id: string; name: string }[]
  onClose: () => void
}

const AVATAR_COLORS = ['#2E7D52', '#1d4ed8', '#b45309', '#7e22ce', '#0f766e', '#be123c', '#4338ca']
function chipColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function chipInitials(name: string) {
  return name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()
}

export function Composer({ leadId, initialRecipients, onClose }: ComposerProps) {
  const { data: lead } = useLead(leadId)
  const sendOutreach = useSendOutreach()
  const currentUser = useAuthStore((s) => s.user)

  const [channel, setChannel] = useState<'email' | 'sms'>('email')
  const [recipients, setRecipients] = useState<{ id: string; name: string }[]>(() => initialRecipients ?? [])
  const [subject, setSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [smsBody, setSmsBody] = useState('')
  const [scheduleLabel, setScheduleLabel] = useState<string | null>(null)
  const [schedOpen, setSchedOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  // Pre-fill recipient from lead contact
  useEffect(() => {
    if (lead?.contact_name && recipients.length === 0) {
      setRecipients([{ id: lead.contact_id ?? 'lead', name: lead.contact_name }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead])

  // Pre-fill email body from AI draft
  useEffect(() => {
    if (lead?.ai_email_draft && !emailBody) {
      setEmailBody(lead.ai_email_draft)
      if (editorRef.current) editorRef.current.innerText = lead.ai_email_draft
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead])

  const MOCK_HOUR = new Date().getHours()
  const quietHours = MOCK_HOUR >= 21 || MOCK_HOUR < 8
  const smsSegs = Math.max(1, Math.ceil(smsBody.length / 160))
  const canSend = recipients.length > 0 && (channel === 'email' ? subject.trim() : smsBody.trim())
  const smsBlocked = channel === 'sms' && quietHours && !scheduleLabel

  async function handleSend() {
    const body = channel === 'email'
      ? (editorRef.current?.innerText ?? emailBody)
      : smsBody
    try {
      await sendOutreach.mutateAsync({
        lead_id: leadId ?? '',
        channel,
        message: body,
      })
      onClose()
    } catch {
      // error toast handled by useSendOutreach
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/[0.42] z-40 flex items-center justify-center p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Modal */}
      <div className="w-[720px] max-w-full max-h-full bg-[hsl(var(--card))] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[hsl(var(--border))]">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[hsl(var(--border))] flex-shrink-0">
          <h2 className="text-[15px] font-bold text-[hsl(var(--fg))]">New message</h2>

          {/* Email / Text segmented control */}
          <div className="flex gap-[3px] bg-[hsl(var(--muted))] rounded-[10px] p-[3px] ml-2">
            {(['email', 'sms'] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannel(ch)}
                className={cn(
                  'text-[12.5px] font-semibold px-4 py-[7px] rounded-lg inline-flex items-center gap-1.5 transition-colors',
                  channel === ch
                    ? 'bg-[hsl(var(--card))] text-[#2E7D52] shadow-sm'
                    : 'text-[hsl(var(--muted-fg))]'
                )}
              >
                {ch === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                {ch === 'email' ? 'Email' : 'Text'}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-[hsl(var(--muted))]"
          >
            <X className="h-[17px] w-[17px] text-[hsl(var(--muted-fg))]" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* To: field */}
          <div className="flex items-start gap-2.5 px-5 py-3 border-b border-[hsl(var(--border))]">
            <label className="text-[12.5px] font-semibold text-[hsl(var(--muted-fg))] w-14 flex-shrink-0 pt-[5px]">To</label>
            <div className="flex-1 flex flex-wrap gap-1.5 items-center">
              {recipients.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 py-1 pl-1 pr-1.5 rounded-full bg-[#2E7D52]/[0.10] text-[#2E7D52] text-xs font-semibold">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                    style={{ background: chipColor(r.name) }}
                  >
                    {chipInitials(r.name)}
                  </span>
                  {r.name}
                  <button
                    type="button"
                    onClick={() => setRecipients(p => p.filter(x => x.id !== r.id))}
                    className="opacity-60 hover:opacity-100 inline-flex"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {recipients.length > 1 && (
                <span className="text-[11.5px] text-[hsl(var(--muted-fg))] font-semibold">
                  Bulk · {recipients.length} recipients
                </span>
              )}
            </div>
          </div>

          {/* Email-only fields */}
          {channel === 'email' && (
            <>
              {/* From */}
              <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[hsl(var(--border))]">
                <label className="text-[12.5px] font-semibold text-[hsl(var(--muted-fg))] w-14 flex-shrink-0">From</label>
                <span className="inline-flex items-center gap-1.5 text-[12.5px] px-2.5 py-1 rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--fg))] font-semibold">
                  {currentUser?.email ?? ''} <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </span>
              </div>

              {/* Subject */}
              <div className="flex items-center gap-2.5 px-5 py-3 border-b border-[hsl(var(--border))]">
                <label className="text-[12.5px] font-semibold text-[hsl(var(--muted-fg))] w-14 flex-shrink-0">Subject</label>
                <input
                  className="flex-1 border-none outline-none text-sm bg-transparent text-[hsl(var(--fg))] placeholder:text-[hsl(var(--muted-fg))]"
                  placeholder="Add a subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-0.5 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
                {[
                  { label: 'Bold', icon: Bold, cmd: 'bold' },
                  { label: 'Italic', icon: Italic, cmd: 'italic' },
                  { label: 'Underline', icon: Underline, cmd: 'underline' },
                ].map(({ label, icon: Icon, cmd }) => (
                  <button
                    key={cmd}
                    type="button"
                    title={label}
                    className="w-[30px] h-[30px] rounded-[7px] border-none bg-transparent cursor-pointer text-[hsl(var(--muted-fg))] inline-flex items-center justify-center hover:bg-[hsl(var(--card))] hover:text-[hsl(var(--fg))]"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      document.execCommand(cmd)
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
                <div className="w-px h-[18px] bg-[hsl(var(--border))] mx-1" />
                <button
                  type="button"
                  title="List"
                  className="w-[30px] h-[30px] rounded-[7px] border-none bg-transparent cursor-pointer text-[hsl(var(--muted-fg))] inline-flex items-center justify-center hover:bg-[hsl(var(--card))] hover:text-[hsl(var(--fg))]"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    document.execCommand('insertUnorderedList')
                  }}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>

              {/* Rich text editor */}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                data-ph="Write your message…"
                className="px-5 py-[18px] min-h-[200px] text-sm leading-[1.65] outline-none text-[hsl(var(--fg))] empty:before:content-[attr(data-ph)] empty:before:text-[hsl(var(--muted-fg))]"
              />
            </>
          )}

          {/* SMS composer */}
          {channel === 'sms' && (
            <div className="p-5">
              <textarea
                className="w-full border border-[hsl(var(--border))] rounded-xl p-3.5 text-sm leading-snug resize-none outline-none bg-[hsl(var(--card))] text-[hsl(var(--fg))] min-h-[130px] focus:border-[#2E7D52]"
                placeholder="Write a text message… Keep it short and personal."
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
              />
              <div className="flex justify-between items-center mt-2 text-[11.5px] text-[hsl(var(--muted-fg))]">
                <span>
                  <b className="text-[hsl(var(--fg))]">{smsBody.length}</b>{' '}
                  chars · <b className="text-[hsl(var(--fg))]">{smsSegs}</b>{' '}
                  segment{smsSegs > 1 ? 's' : ''}
                </span>
              </div>

              {/* Compliance notice */}
              <div className="flex gap-[9px] px-[13px] py-[11px] rounded-[10px] text-xs leading-snug mt-3 bg-sky-100 text-sky-700">
                <Info className="h-[15px] w-[15px] flex-shrink-0 mt-[1px]" />
                <span>
                  <b>Compliance:</b> Msg &amp; data rates may apply. Recipients can reply STOP to opt out — Juniper auto-suppresses opt-outs.
                </span>
              </div>

              {/* Quiet hours warning */}
              {smsBlocked && (
                <div className="flex gap-[9px] px-[13px] py-[11px] rounded-[10px] text-xs leading-snug mt-2 bg-amber-100 text-amber-800">
                  <Clock className="h-[15px] w-[15px] flex-shrink-0 mt-[1px]" />
                  <span>
                    <b>Quiet hours (9:00 PM–8:00 AM).</b> Texts can&apos;t send now under TCPA rules.{' '}
                    <button
                      type="button"
                      className="font-bold underline cursor-pointer"
                      onClick={() => setScheduleLabel('Tomorrow 8:00 AM')}
                    >
                      Schedule for 8:00 AM
                    </button>{' '}
                    instead.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="relative flex items-center gap-2.5 px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] flex-shrink-0">
          <div className="flex-1" />

          {/* Scheduled label chip */}
          {scheduleLabel && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold bg-[#2E7D52]/[0.12] text-[#2E7D52]">
              <Clock className="h-3 w-3" /> {scheduleLabel}
              <button
                type="button"
                onClick={() => setScheduleLabel(null)}
                className="opacity-60 hover:opacity-100 inline-flex"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {/* Split send button */}
          <div className="inline-flex">
            <Button
              className="bg-[#2E7D52] hover:bg-[#256644] text-white gap-1.5 rounded-r-none"
              disabled={!canSend || smsBlocked || sendOutreach.isPending}
              onClick={handleSend}
            >
              <Send className="h-4 w-4" />
              {scheduleLabel
                ? 'Schedule send'
                : recipients.length > 1
                  ? `Send to ${recipients.length}`
                  : 'Send'}
            </Button>
            <button
              type="button"
              title="Schedule"
              aria-label="Schedule"
              disabled={!canSend}
              onClick={() => setSchedOpen(o => !o)}
              className="bg-[#2E7D52] hover:bg-[#256644] text-white px-2.5 rounded-l-none border-l border-l-white/25 inline-flex items-center justify-center disabled:opacity-50"
            >
              <Clock className="h-4 w-4" />
            </button>
          </div>

          {/* Schedule popover */}
          {schedOpen && (
            <div className="absolute bottom-[62px] right-5 z-60 w-[280px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl shadow-xl p-4">
              <h4 className="text-[13px] font-bold mb-3">Schedule send</h4>
              {[
                { label: 'Tomorrow morning', sub: '8:00 AM', v: 'Tomorrow 8:00 AM' },
                { label: 'Tomorrow afternoon', sub: '1:00 PM', v: 'Tomorrow 1:00 PM' },
                { label: 'Monday morning', sub: '8:00 AM', v: 'Mon 8:00 AM' },
              ].map((qk) => (
                <button
                  key={qk.v}
                  type="button"
                  className="w-full text-left border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-sm px-3 py-2.5 rounded-[9px] mb-1.5 flex justify-between hover:border-[#2E7D52] hover:bg-[hsl(var(--muted))]"
                  onClick={() => {
                    setScheduleLabel(qk.v)
                    setSchedOpen(false)
                  }}
                >
                  {qk.label}
                  <b className="text-[hsl(var(--muted-fg))] font-semibold">{qk.sub}</b>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
