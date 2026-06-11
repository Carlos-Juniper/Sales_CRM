import { useState } from 'react'
import { useSendOutreach } from '@/hooks/useLeads'
import type { Lead } from '@/types'

export function useOutreachDrafts(lead: Lead | undefined) {
  const [emailDraft, setEmailDraft] = useState<string | null>(null)
  const [linkedinDraft, setLinkedinDraft] = useState<string | null>(null)
  const sendOutreach = useSendOutreach()

  const effectiveEmail = emailDraft ?? lead?.ai_email_draft ?? ''
  const effectiveLinkedin = linkedinDraft ?? lead?.ai_linkedin_draft ?? ''

  async function handleSend(channel: 'email' | 'linkedin') {
    if (!lead) return
    const message = channel === 'email' ? effectiveEmail : effectiveLinkedin
    try {
      await sendOutreach.mutateAsync({ lead_id: lead.id, channel, message })
      if (channel === 'email') setEmailDraft(null)
      else setLinkedinDraft(null)
    } catch {
      // useSendOutreach onError already surfaces a toast
    }
  }

  return {
    effectiveEmail,
    effectiveLinkedin,
    setEmailDraft,
    setLinkedinDraft,
    handleSend,
    isPending: sendOutreach.isPending,
  }
}
