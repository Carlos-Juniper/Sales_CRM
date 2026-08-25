import type { EstimatingTabConfig } from './estimatingTabs'

/**
 * Graceful placeholder for Estimating tabs whose feature
 * hasn't been built yet, so the shell ships independently.
 */
export function TabPlaceholder({ tab }: { tab: EstimatingTabConfig }) {
  const Icon = tab.icon
  return (
    <div
      data-testid="estimating-tab-placeholder"
      className="flex flex-col items-center justify-center gap-3 py-24 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
        <Icon className="h-6 w-6 text-[hsl(var(--muted-fg))]" />
      </div>
      <div>
        <p className="text-sm font-semibold text-[hsl(var(--fg))]">{tab.label}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted-fg))]">
          This workspace is on its way — it will mount here once its feature ships.
        </p>
      </div>
    </div>
  )
}
