import { BarChart3, Users, Settings, TrendingUp, MapPin, DollarSign } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { ScrollArea } from '@/components/ui/scroll-area'

const MODULES = [
  { icon: BarChart3, title: 'Executive Dashboard', description: 'Cross-branch pipeline summary, revenue forecasting, and key performance metrics with drill-down capability.' },
  { icon: Users, title: 'Team Performance', description: 'Individual rep performance tracking: leads contacted, proposals sent, win rate, and revenue generated.' },
  { icon: TrendingUp, title: 'Pipeline Analytics', description: 'Stage conversion rates, average deal velocity, and pipeline trend analysis with comparison to prior periods.' },
  { icon: MapPin, title: 'Territory Heat Map', description: 'Geographic visualization of lead density, win rates, and coverage gaps across the service territory.' },
  { icon: DollarSign, title: 'Revenue Forecast', description: 'Forward-looking revenue projection based on current pipeline, historical win rates, and seasonality factors.' },
  { icon: Settings, title: 'Branch Operations', description: 'Crew scheduling, equipment utilization, and capacity planning tools integrated with the proposal pipeline.' },
]

export default function BranchManagerPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav title="Branch Manager" subtitle="Management View — Phase 3" />
      <ScrollArea className="flex-1">
        <div className="p-5 space-y-6">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800">
            <div className="h-10 w-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">Coming in Phase 3 — Branch Manager</h2>
              <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-0.5">
                Cross-view access with executive reporting, team performance, territory analytics, and revenue forecasting.
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
