import { useContactConsent } from '@/hooks/useConsent'

interface ConsentBadgeProps {
  contactId: string | null | undefined
}

export function ConsentBadge({ contactId }: ConsentBadgeProps) {
  const { data: consent } = useContactConsent(contactId ?? null)

  if (!consent || (!consent.do_not_call && !consent.do_not_text && !consent.do_not_email)) {
    return null
  }

  return (
    <div className="flex items-center gap-1 flex-wrap" aria-label="Contact communication restrictions">
      {consent.do_not_call && (
        <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 whitespace-nowrap">
          DNC: Call
        </span>
      )}
      {consent.do_not_text && (
        <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 whitespace-nowrap">
          DNC: Text
        </span>
      )}
      {consent.do_not_email && (
        <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 whitespace-nowrap">
          DNC: Email
        </span>
      )}
    </div>
  )
}
