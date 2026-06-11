import { useState, useMemo } from 'react'
import { Calculator, ClipboardList, FileOutput, BarChart2 } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { EstimateQueue } from './components/estimating/EstimateQueue'
import { LineItemEditor } from './components/estimating/LineItemEditor'
import { ProposalExport } from './components/estimating/ProposalExport'
import { MarginAnalysis } from './components/estimating/MarginAnalysis'
import { mockEstimates, mockEstimateQueue } from '@/mocks/estimatingData'
import { cn } from '@/lib/utils'

type EstTab = 'queue' | 'editor' | 'proposal' | 'margins'

const TABS: { id: EstTab; label: string; shortLabel: string; icon: React.ElementType }[] = [
  { id: 'queue', label: 'Estimate Queue', shortLabel: 'Queue', icon: ClipboardList },
  { id: 'editor', label: 'Line-Item Editor', shortLabel: 'Editor', icon: Calculator },
  { id: 'proposal', label: 'Proposal Export', shortLabel: 'Proposal', icon: FileOutput },
  { id: 'margins', label: 'Margin Analysis', shortLabel: 'Margins', icon: BarChart2 },
]

export default function EstimatingPage() {
  const [activeTab, setActiveTab] = useState<EstTab>('queue')
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null)

  const estimate = useMemo(() => {
    if (!selectedQueueId) return mockEstimates[0]
    return mockEstimates.find((e) => e.queue_item_id === selectedQueueId) ?? mockEstimates[0]
  }, [selectedQueueId])

  const queueItem = useMemo(
    () => mockEstimateQueue.find((q) => q.id === estimate.queue_item_id),
    [estimate],
  )

  function handleSelectQueueItem(id: string) {
    setSelectedQueueId(id)
    setActiveTab('editor')
  }

  function handleSaveEstimate() {
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav
        title="Estimating"
        subtitle="Estimate queue, line-item editor, proposal export, margin analysis"
      />

      {/* Tab bar — scrollable on mobile */}
      <div className="flex-shrink-0 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg))] overflow-x-auto">
        <div className="flex min-w-max px-2">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  active
                    ? 'border-[#2E7D52] text-[#2E7D52]'
                    : 'border-transparent text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] hover:border-[hsl(var(--border))]'
                )}
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {activeTab === 'queue' && (
          <EstimateQueue onSelectItem={handleSelectQueueItem} selectedId={selectedQueueId} />
        )}
        {activeTab === 'editor' && (
          <LineItemEditor estimate={estimate} queueItem={queueItem} onSave={handleSaveEstimate} />
        )}
        {activeTab === 'proposal' && (
          <ProposalExport selectedQueueId={selectedQueueId} />
        )}
        {activeTab === 'margins' && (
          <MarginAnalysis selectedQueueId={selectedQueueId} />
        )}
      </div>
    </div>
  )
}
