import { Mail, CheckCircle2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { OutreachHistory } from '@/types'

interface HistoryTabProps {
  outreach: OutreachHistory[]
}

export function HistoryTab({ outreach }: HistoryTabProps) {
  if (outreach.length === 0) {
    return (
      <div className="px-6 py-5 flex flex-col items-center py-8 text-center">
        <Mail className="h-8 w-8 text-gray-300 mb-3" />
        <p className="text-sm text-gray-400">No outreach history yet.</p>
      </div>
    )
  }

  return (
    <div className="px-6 py-5 space-y-3">
      {outreach.map((item) => (
        <div key={item.id} className="flex gap-3">
          <div className="flex-shrink-0 h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center mt-0.5">
            <Mail className="h-3.5 w-3.5 text-gray-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-700 capitalize">
                Step {item.sequence_step} — {item.channel}
              </span>
              <span className="text-[10px] text-gray-400">{formatDate(item.sent_at)}</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.message}</p>
            <div className="mt-1">
              {item.response_received ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Response received {item.response_at ? formatDate(item.response_at) : ''}
                </span>
              ) : (
                <span className="text-[10px] text-gray-400">No response yet</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
