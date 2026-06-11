import { Map, Camera, Mic, FileText, ClipboardCheck } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { ScrollArea } from '@/components/ui/scroll-area'

const MODULES = [
  { icon: Map, title: 'Site Walk Capture', description: 'GPS-tagged photo capture and notes from the field. Structured capture form with property details, condition assessment, and scope of work.' },
  { icon: Mic, title: 'Voice Dictation Upload', description: 'Record voice memos during site walks and upload for AI transcription and summarization into proposal context.' },
  { icon: Camera, title: 'Photo Gallery', description: 'Organized photo gallery per property with tagging, annotations, and before/after comparison views.' },
  { icon: FileText, title: 'Proposal Draft Viewer', description: 'Review AI-generated proposal drafts on mobile, annotate, and approve before submission to estimating.' },
  { icon: ClipboardCheck, title: 'Submit to Estimating', description: 'One-tap handoff of site walk data, photos, and notes to the estimating queue with priority flagging.' },
]

export default function OutsideSalesPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="Field View" subtitle="Outside Sales — Phase 2" />
      <ScrollArea className="flex-1">
        <div className="p-5 space-y-6">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
              <Map className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">Coming in Phase 2 — Outside Sales</h2>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Mobile-first field tools for outside sales reps. Site walks, photo capture, voice dictation, and proposal handoffs.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[hsl(var(--fg))]">Planned modules</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {MODULES.map(({ icon: Icon, title, description }) => (
                <div key={title} className="p-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
                      <Icon className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
                    </div>
                    <h4 className="text-xs font-semibold text-[hsl(var(--fg))]">{title}</h4>
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-fg))]">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
