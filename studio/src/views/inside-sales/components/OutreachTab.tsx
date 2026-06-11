import { Mail } from 'lucide-react'
import { AlertTriangle } from 'lucide-react'
import { LinkedinIcon as Linkedin } from '@/components/shared/LinkedinIcon'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useOutreachDrafts } from '@/hooks/useOutreachDrafts'
import type { Lead } from '@/types'

interface OutreachTabProps {
  lead: Lead
}

export function OutreachTab({ lead }: OutreachTabProps) {
  const { effectiveEmail, effectiveLinkedin, setEmailDraft, setLinkedinDraft, handleSend, isPending } =
    useOutreachDrafts(lead)

  return (
    <div className="px-6 py-5 space-y-5">
      {lead.ai_email_draft && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Mail className="h-3.5 w-3.5 text-gray-400" />
              Email draft
            </label>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">AI-generated</span>
          </div>
          <Textarea
            value={effectiveEmail}
            onChange={(e) => setEmailDraft(e.target.value)}
            rows={8}
            className="text-xs font-mono"
          />
          <Button
            className="w-full bg-[#2E7D52] hover:bg-[#256644] text-white"
            onClick={() => handleSend('email')}
            disabled={isPending || !effectiveEmail.trim()}
          >
            <Mail className="h-4 w-4" />
            {isPending ? 'Sending…' : 'Send Email'}
          </Button>
        </div>
      )}

      {lead.ai_linkedin_draft && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Linkedin className="h-3.5 w-3.5 text-gray-400" />
              LinkedIn message
            </label>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">AI-generated</span>
          </div>
          <Textarea
            value={effectiveLinkedin}
            onChange={(e) => setLinkedinDraft(e.target.value)}
            rows={4}
            className="text-xs"
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => handleSend('linkedin')}
            disabled={isPending || !effectiveLinkedin.trim()}
          >
            <Linkedin className="h-4 w-4" />
            {isPending ? 'Sending…' : 'Send LinkedIn'}
          </Button>
        </div>
      )}

      {!lead.ai_email_draft && !lead.ai_linkedin_draft && (
        <div className="flex flex-col items-center py-8 text-center">
          <AlertTriangle className="h-8 w-8 text-gray-300 mb-3" />
          <p className="text-sm text-gray-400">No AI drafts available for this lead.</p>
        </div>
      )}
    </div>
  )
}
